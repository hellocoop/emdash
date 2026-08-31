/**
 * GET /_emdash/api/auth/hello/callback
 *
 * Handles the redirect back from the Hellō Wallet: validates state, exchanges
 * the authorization code (PKCE) for an ID token, validates its claims
 * (iss, aud, nonce, exp), resolves or creates the EmDash user, and
 * establishes the session.
 *
 * User resolution order:
 *   1. Existing hello link for this sub (oauth_accounts)
 *   2. Logged-in session user → link this sub (error if linked elsewhere)
 *   3. Existing user with the same verified email → auto-link
 *   4. First user during setup → Admin; otherwise autoProvision policy
 *
 * The ID token is obtained directly from the Hellō token endpoint over TLS
 * with PKCE and a nonce check, so a JWKS signature check is not required
 * here (same trust model as the Hellō WordPress plugin and quickstarts).
 */

import type { APIRoute } from "astro";

export const prerender = false;

import {
	findOrCreateOAuthUser,
	OAuthError,
	Role,
	toRoleLevel,
	type OAuthProfile,
	type RoleLevel,
} from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { finalizeSetup, getPublicOrigin, OptionsRepository } from "emdash/api/route-utils";
import { decodeJwt } from "jose";

const STATE_TTL_MS = 10 * 60 * 1000;
const PROVIDER = "hello";

function loginError(code: string, message: string): string {
	return `/_emdash/admin/login?error=${code}&message=${encodeURIComponent(message)}`;
}

export const GET: APIRoute = async ({ request, locals, session, redirect }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return redirect(loginError("server_error", "Database not configured"));
	}

	try {
		const url = new URL(request.url);
		const baseUrl = getPublicOrigin(url, emdash?.config);

		// Errors relayed from the wallet
		const walletError = url.searchParams.get("error");
		if (walletError) {
			const message = url.searchParams.get("error_description") || walletError;
			return redirect(loginError("hello_denied", message));
		}

		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (!code || !state) {
			return redirect(loginError("hello_error", "Missing code or state"));
		}

		const { resolveHelloConfig, matchesAllowedEmails } = await import("../config.js");
		const { getHelloProviderConfig, getHelloStorage, resolveClientId } =
			await import("../storage.js");

		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- emdash locals satisfy EmdashLocals shape required by getHelloStorage
		const emdashLocals = emdash as unknown as Parameters<typeof getHelloStorage>[0];
		const config = resolveHelloConfig(getHelloProviderConfig(emdashLocals));
		const storage = await getHelloStorage(emdashLocals);
		if (!storage) {
			return redirect(loginError("server_error", "Hellō provider storage not configured"));
		}

		// Single-use state: read then delete before any network calls
		const stored = await storage.states.get(state);
		await storage.states.delete(state);
		if (!stored || Date.now() - stored.createdAt > STATE_TTL_MS) {
			return redirect(loginError("hello_error", "Login expired — please try again"));
		}

		const clientId = await resolveClientId(config, storage);
		if (!clientId) {
			return redirect(loginError("hello_not_configured", "Hellō client_id is not configured"));
		}

		const { fetchToken } = await import("@hellocoop/helper-server");
		const idToken = await fetchToken({
			code,
			code_verifier: stored.codeVerifier,
			client_id: clientId,
			redirect_uri: `${baseUrl}/_emdash/api/auth/hello/callback`,
			wallet: config.wallet,
		});

		const payload = decodeJwt(idToken);
		if (payload.iss !== config.issuer) {
			return redirect(loginError("hello_error", "Unexpected issuer"));
		}
		if (payload.aud !== clientId) {
			return redirect(loginError("hello_error", "Unexpected audience"));
		}
		if (payload.nonce !== stored.nonce) {
			return redirect(loginError("hello_error", "Nonce mismatch"));
		}
		if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
			return redirect(loginError("hello_error", "Token expired"));
		}
		const sub = payload.sub;
		const email = typeof payload.email === "string" ? payload.email : undefined;
		const emailVerified = payload.email_verified !== false;
		const name = typeof payload.name === "string" ? payload.name : undefined;
		const picture = typeof payload.picture === "string" ? payload.picture : undefined;
		if (!sub || !email) {
			return redirect(loginError("hello_error", "Missing sub or email claim"));
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Database uses Generated<> wrappers incompatible with AuthTables structurally; safe at runtime
		const adapter = createKyselyAdapter(
			emdash.db as unknown as Parameters<typeof createKyselyAdapter>[0],
		);

		// OPC tombstone: a deleted account may not sign back in
		const accountRecord = await storage.accounts.get(sub);
		if (accountRecord?.state === "deleted") {
			return redirect(loginError("account_deleted", "This account has been deleted"));
		}

		// Logged-in user linking their Hellō account
		const sessionUser = await session?.get("user");
		if (sessionUser?.id) {
			const existingLink = await adapter.getOAuthAccount(PROVIDER, sub);
			if (existingLink && existingLink.userId !== sessionUser.id) {
				return redirect(
					loginError("hello_error", "This Hellō account is linked to a different user"),
				);
			}
			if (!existingLink) {
				await adapter.createOAuthAccount({
					provider: PROVIDER,
					providerAccountId: sub,
					userId: sessionUser.id,
				});
			}
			return redirect(stored.returnTo || "/_emdash/admin");
		}

		// First-user gate via setup_complete (avoids the countUsers TOCTOU race)
		const options = new OptionsRepository(emdash.db);
		const setupComplete = await options.get("emdash:setup_complete");
		const isFirstUser = setupComplete !== true && setupComplete !== "true";

		let defaultRole: RoleLevel = Role.SUBSCRIBER;
		try {
			defaultRole = toRoleLevel(config.defaultRole);
		} catch {
			console.warn(
				`[hello-auth] Invalid defaultRole ${config.defaultRole}, using SUBSCRIBER (${Role.SUBSCRIBER})`,
			);
		}

		const profile: OAuthProfile = {
			id: sub,
			email,
			name: name || email,
			avatarUrl: picture ?? null,
			emailVerified,
		};

		const user = await findOrCreateOAuthUser(adapter, PROVIDER, profile, async () => {
			if (isFirstUser) {
				return { allowed: true, role: Role.ADMIN };
			}
			if (!config.autoProvision) return null;
			if (config.allowedEmails && !matchesAllowedEmails(email, config.allowedEmails)) {
				return null;
			}
			if (!config.allowedEmails) {
				// No allowlist: only the initial admin may self-provision
				return null;
			}
			return { allowed: true, role: defaultRole };
		});

		if (isFirstUser) {
			// finalizeSetup is idempotent — safe if two callbacks race past the check
			await finalizeSetup(emdash.db);
			console.log(`[hello-auth] Setup complete: created admin user via Hellō`);
		}

		if (user.disabled) {
			return redirect(loginError("account_disabled", "Account disabled"));
		}

		// Keep name/email fresh from the wallet on each login
		const updates: { name?: string; email?: string } = {};
		if (name && user.name !== name) updates.name = name;
		if (emailVerified && user.email !== email) updates.email = email;
		if (Object.keys(updates).length > 0) {
			await adapter.updateUser(user.id, updates);
		}

		if (session) {
			session.set("user", { id: user.id });
		}

		return redirect(stored.returnTo || "/_emdash/admin");
	} catch (callbackError) {
		console.error("[hello-auth] Callback error:", callbackError);

		let message = "Hellō authentication failed. Please try again.";
		let errorCode = "hello_error";

		if (callbackError instanceof OAuthError) {
			errorCode = callbackError.code;
			switch (callbackError.code) {
				case "signup_not_allowed":
					message = "Self-signup is not allowed. Please contact an administrator.";
					break;
				case "user_not_found":
					message = "Your account was not found. It may have been deleted.";
					break;
				default:
					break;
			}
		}

		return redirect(loginError(errorCode, message));
	}
};
