/**
 * Command dispatch — applies verified OpenID Provider Commands to EmDash users.
 *
 * Account addressing is by Hellō `sub`, resolved through the oauth_accounts
 * link (provider "hello"). Lifecycle state beyond EmDash's `disabled` flag
 * (archived, deleted tombstones) lives in the provider's `accounts` storage
 * collection so state-machine semantics survive user deletion.
 *
 * State-machine semantics match the opcrp test RP: a transition to the
 * current state, or any transition from `deleted`, is 409 incompatible_state
 * with the current `account_state` in the body.
 */

import type { AccountState, Command, CommandClaims } from "./types.js";
import { COMMANDS_SUPPORTED } from "./types.js";

export interface CommandUser {
	id: string;
	email: string;
	name: string | null;
	disabled: boolean;
}

/** The slice of @emdash-cms/auth's AuthAdapter the command handler uses. */
export interface CommandUserAdapter {
	getOAuthAccount(provider: string, providerAccountId: string): Promise<{ userId: string } | null>;
	createOAuthAccount(account: {
		provider: string;
		providerAccountId: string;
		userId: string;
	}): Promise<unknown>;
	deleteOAuthAccount(provider: string, providerAccountId: string): Promise<void>;
	getUserById(id: string): Promise<CommandUser | null>;
	getUserByEmail(email: string): Promise<CommandUser | null>;
	createUser(user: {
		email: string;
		name?: string | null;
		role?: number;
		emailVerified?: boolean;
	}): Promise<CommandUser>;
	updateUser(
		id: string,
		data: { email?: string; name?: string | null; disabled?: boolean },
	): Promise<void>;
	deleteUser(id: string): Promise<void>;
}

export interface AccountStateStore {
	get(id: string): Promise<{ state: string; userId?: string; updatedAt: number } | null>;
	put(id: string, data: { state: string; userId?: string; updatedAt: number }): Promise<void>;
}

export interface CommandDeps {
	adapter: CommandUserAdapter;
	accounts: AccountStateStore;
	commandEndpoint: string;
	clientId: string;
	defaultRole: number;
}

const PROVIDER = "hello";

const TARGET_STATE: Partial<Record<Command, AccountState>> = {
	suspend: "suspended",
	reactivate: "active",
	archive: "archived",
	restore: "active",
	delete: "deleted",
};

function json(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

function opcError(
	status: number,
	error: string,
	error_description?: string,
	extra?: Record<string, unknown>,
): Response {
	return json(status, {
		error,
		...(error_description ? { error_description } : {}),
		...extra,
	});
}

interface Located {
	sub: string;
	userId?: string;
	user: CommandUser | null;
	state: AccountState;
}

async function locate(deps: CommandDeps, claims: CommandClaims): Promise<Located | null> {
	const sub = claims.sub;
	if (!sub) return null;

	const record = await deps.accounts.get(sub);
	const link = await deps.adapter.getOAuthAccount(PROVIDER, sub);
	const user = link ? await deps.adapter.getUserById(link.userId) : null;

	if (!record && !user) return null;

	let state: AccountState;
	if (record?.state === "deleted") {
		state = "deleted";
	} else if (record?.state === "archived") {
		state = "archived";
	} else if (user) {
		state = user.disabled ? "suspended" : "active";
	} else if (record) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- stored states are only ever written from AccountState values
		state = record.state as AccountState;
	} else {
		state = "active";
	}

	return { sub, userId: user?.id ?? link?.userId ?? record?.userId, user, state };
}

export async function handleCommand(claims: CommandClaims, deps: CommandDeps): Promise<Response> {
	const { command } = claims;

	if (command === "metadata") {
		return json(200, {
			context: { iss: claims.iss, tenant: claims.tenant },
			command_endpoint: deps.commandEndpoint,
			commands_supported: COMMANDS_SUPPORTED,
			client_id: deps.clientId,
		});
	}

	if (!COMMANDS_SUPPORTED.includes(command)) {
		return opcError(400, "unsupported_command");
	}

	if (command === "activate") {
		return activate(claims, deps);
	}

	const located = await locate(deps, claims);
	if (!located) {
		return opcError(400, "invalid_request", claims.sub ? "unknown account" : "sub required");
	}

	switch (command) {
		case "audit":
			return json(200, { account_state: located.state });

		case "invalidate":
			// EmDash exposes no per-user session enumeration to providers yet;
			// acknowledged so the OP can proceed, matching opcrp's no-op ack.
			return json(200, { account_state: located.state });

		case "maintain": {
			if (located.state === "deleted" || !located.user) {
				return opcError(409, "incompatible_state", undefined, { account_state: located.state });
			}
			const updates: { email?: string; name?: string } = {};
			if (typeof claims.email === "string" && claims.email !== located.user.email) {
				updates.email = claims.email;
			}
			if (typeof claims.name === "string" && claims.name !== located.user.name) {
				updates.name = claims.name;
			}
			if (Object.keys(updates).length > 0) {
				await deps.adapter.updateUser(located.user.id, updates);
			}
			await deps.accounts.put(located.sub, {
				state: located.state,
				userId: located.user.id,
				updatedAt: Date.now(),
			});
			return json(200, { account_state: located.state });
		}

		case "suspend":
		case "reactivate":
		case "archive":
		case "restore":
		case "delete": {
			const target = TARGET_STATE[command]!;
			if (located.state === target || located.state === "deleted") {
				return opcError(409, "incompatible_state", undefined, { account_state: located.state });
			}

			if (command === "delete") {
				if (located.userId) {
					await deps.adapter.deleteUser(located.userId);
					await deps.adapter.deleteOAuthAccount(PROVIDER, located.sub);
				}
				await deps.accounts.put(located.sub, { state: "deleted", updatedAt: Date.now() });
				return json(200, { account_state: "deleted" });
			}

			const disabled = target !== "active";
			if (located.userId) {
				await deps.adapter.updateUser(located.userId, { disabled });
			}
			await deps.accounts.put(located.sub, {
				state: target,
				userId: located.userId,
				updatedAt: Date.now(),
			});
			return json(200, { account_state: target });
		}

		default:
			return opcError(400, "unsupported_command");
	}
}

async function activate(claims: CommandClaims, deps: CommandDeps): Promise<Response> {
	const sub = claims.sub;
	if (!sub) return opcError(400, "invalid_request", "sub required for activate");
	if (!claims.email) return opcError(400, "invalid_request", "email required for activate");

	const existingLocated = await locate(deps, claims);
	if (existingLocated) {
		return opcError(409, "incompatible_state", undefined, {
			account_state: existingLocated.state,
		});
	}

	const existingByEmail = await deps.adapter.getUserByEmail(claims.email);
	if (existingByEmail) {
		return opcError(409, "incompatible_state", undefined, {
			account_state: existingByEmail.disabled ? "suspended" : "active",
		});
	}

	const user = await deps.adapter.createUser({
		email: claims.email,
		name: claims.name ?? null,
		role: deps.defaultRole,
		emailVerified: claims.email_verified ?? true,
	});
	await deps.adapter.createOAuthAccount({
		provider: PROVIDER,
		providerAccountId: sub,
		userId: user.id,
	});
	await deps.accounts.put(sub, { state: "active", userId: user.id, updatedAt: Date.now() });

	return json(200, { account_state: "active" });
}
