/**
 * GET /_emdash/api/auth/hello/login
 *
 * Starts the Hellō authorization code + PKCE flow: builds the authorization
 * request, stores state + PKCE verifier + nonce (single-use, short TTL) in
 * provider storage, and redirects the browser to the Hellō Wallet.
 *
 * Accepts ?returnTo=/some/path (same-origin path only) for post-login
 * redirect.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { getPublicOrigin } from "emdash/api/route-utils";

export const GET: APIRoute = async ({ request, locals, redirect }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return redirect(
			`/_emdash/admin/login?error=server_error&message=${encodeURIComponent("Database not configured")}`,
		);
	}

	try {
		const url = new URL(request.url);
		const baseUrl = getPublicOrigin(url, emdash?.config);

		const { resolveHelloConfig } = await import("../config.js");
		const { getHelloProviderConfig, getHelloStorage, resolveClientId } =
			await import("../storage.js");

		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- emdash locals satisfy EmdashLocals shape required by getHelloStorage
		const emdashLocals = emdash as unknown as Parameters<typeof getHelloStorage>[0];
		const config = resolveHelloConfig(getHelloProviderConfig(emdashLocals));
		const storage = await getHelloStorage(emdashLocals);
		if (!storage) {
			return redirect(
				`/_emdash/admin/login?error=server_error&message=${encodeURIComponent("Hellō provider storage not configured")}`,
			);
		}

		const clientId = await resolveClientId(config, storage);
		if (!clientId) {
			return redirect(
				`/_emdash/admin/login?error=hello_not_configured&message=${encodeURIComponent("Hellō client_id is not configured. Run Quickstart from the admin settings.")}`,
			);
		}

		// Same-origin relative paths only — never an absolute URL
		const returnToParam = url.searchParams.get("returnTo");
		const returnTo =
			returnToParam?.startsWith("/") && !returnToParam.startsWith("//")
				? returnToParam
				: undefined;

		const { createAuthRequest } = await import("@hellocoop/helper-server");
		const redirect_uri = `${baseUrl}/_emdash/api/auth/hello/callback`;
		const {
			url: authUrl,
			nonce,
			code_verifier,
		} = await createAuthRequest({
			client_id: clientId,
			redirect_uri,
			scope: config.scopes,
			wallet: config.wallet,
			...(config.providerHint ? { provider_hint: config.providerHint } : {}),
		});

		const state = crypto.randomUUID();
		await storage.states.put(state, {
			nonce,
			codeVerifier: code_verifier,
			...(returnTo ? { returnTo } : {}),
			createdAt: Date.now(),
		});

		const authorizeUrl = new URL(authUrl);
		authorizeUrl.searchParams.set("state", state);

		return redirect(authorizeUrl.toString());
	} catch (error) {
		console.error("[hello-auth] Login error:", error);
		return redirect(
			`/_emdash/admin/login?error=hello_error&message=${encodeURIComponent("Failed to start Hellō login")}`,
		);
	}
};
