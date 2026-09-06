import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { handleCommand, type CommandDeps, type CommandUser } from "../src/commands/handler.js";
import type { CommandClaims } from "../src/commands/types.js";
import { buildIssuerAllowlist, verifyCommandToken } from "../src/commands/verify.js";

const ISSUER = "https://issuer.test.example";
const ENDPOINT = "https://site.example.com/_emdash/api/auth/hello/commands";

let privateKey: CryptoKey;
let issuers: ReturnType<typeof buildIssuerAllowlist>;

beforeAll(async () => {
	const pair = await generateKeyPair("ES256");
	privateKey = pair.privateKey;
	const jwk = await exportJWK(pair.publicKey);
	issuers = buildIssuerAllowlist([
		{ issuer: ISSUER, jwks: { keys: [{ ...jwk, alg: "ES256" }] } },
	]);
});

async function makeToken(
	claims: Record<string, unknown>,
	opts: { typ?: string } = {},
): Promise<string> {
	const jwt = new SignJWT({
		iss: ISSUER,
		aud: ENDPOINT,
		client_id: "test-client",
		jti: crypto.randomUUID(),
		tenant: "default",
		...claims,
	})
		.setProtectedHeader({ alg: "ES256", typ: opts.typ ?? "command+jwt" })
		.setIssuedAt()
		.setExpirationTime("5m");
	return jwt.sign(privateKey);
}

describe("verifyCommandToken", () => {
	it("verifies a well-formed command token", async () => {
		const token = await makeToken({ command: "metadata" });
		const result = await verifyCommandToken(token, ENDPOINT, issuers);
		expect("claims" in result && result.claims.command).toBe("metadata");
	});

	it("rejects a wrong typ header", async () => {
		const token = await makeToken({ command: "metadata" }, { typ: "JWT" });
		const result = await verifyCommandToken(token, ENDPOINT, issuers);
		expect("error" in result && result.error).toBe("invalid_request");
	});

	it("rejects an unknown issuer with 401 unrecognized_provider", async () => {
		const token = await makeToken({ command: "metadata", iss: "https://evil.example" });
		const result = await verifyCommandToken(token, ENDPOINT, issuers);
		expect("error" in result && result.error).toBe("unrecognized_provider");
		expect("status" in result && result.status).toBe(401);
	});

	it("rejects an audience that is not the command endpoint", async () => {
		const token = await makeToken({ command: "metadata", aud: "https://other.example/cmd" });
		const result = await verifyCommandToken(token, ENDPOINT, issuers);
		expect("error" in result && result.error).toBe("invalid_request");
	});

	it("rejects a token carrying a nonce claim", async () => {
		const token = await makeToken({ command: "metadata", nonce: "abc" });
		const result = await verifyCommandToken(token, ENDPOINT, issuers);
		expect("error" in result && result.error_description).toMatch(/nonce/);
	});

	it("rejects a token missing a baseline claim", async () => {
		// no tenant
		const jwt = await new SignJWT({
			iss: ISSUER,
			aud: ENDPOINT,
			client_id: "test-client",
			jti: crypto.randomUUID(),
			command: "metadata",
		})
			.setProtectedHeader({ alg: "ES256", typ: "command+jwt" })
			.setIssuedAt()
			.setExpirationTime("5m")
			.sign(privateKey);
		const result = await verifyCommandToken(jwt, ENDPOINT, issuers);
		expect("error" in result && result.error).toBe("invalid_request");
	});
});

// ---------------------------------------------------------------------------
// Command dispatch against in-memory fakes
// ---------------------------------------------------------------------------

interface FakeState {
	users: Map<string, CommandUser>;
	links: Map<string, string>; // "hello|sub" → userId
	accounts: Map<string, { state: string; userId?: string; updatedAt: number }>;
	nextId: number;
}

function makeDeps(): { deps: CommandDeps; state: FakeState } {
	const state: FakeState = {
		users: new Map(),
		links: new Map(),
		accounts: new Map(),
		nextId: 1,
	};
	const deps: CommandDeps = {
		adapter: {
			async getOAuthAccount(provider, sub) {
				const userId = state.links.get(`${provider}|${sub}`);
				return userId ? { userId } : null;
			},
			async createOAuthAccount({ provider, providerAccountId, userId }) {
				state.links.set(`${provider}|${providerAccountId}`, userId);
				return {};
			},
			async deleteOAuthAccount(provider, sub) {
				state.links.delete(`${provider}|${sub}`);
			},
			async getUserById(id) {
				return state.users.get(id) ?? null;
			},
			async getUserByEmail(email) {
				for (const user of state.users.values()) {
					if (user.email === email) return user;
				}
				return null;
			},
			async createUser({ email, name }) {
				const user: CommandUser = {
					id: `u${state.nextId++}`,
					email,
					name: name ?? null,
					disabled: false,
				};
				state.users.set(user.id, user);
				return user;
			},
			async updateUser(id, data) {
				const user = state.users.get(id);
				if (!user) throw new Error("no user");
				state.users.set(id, { ...user, ...data });
			},
			async deleteUser(id) {
				state.users.delete(id);
			},
		},
		accounts: {
			async get(id) {
				return state.accounts.get(id) ?? null;
			},
			async put(id, data) {
				state.accounts.set(id, data);
			},
		},
		commandEndpoint: ENDPOINT,
		clientId: "test-client",
		defaultRole: 10,
	};
	return { deps, state };
}

function claimsFor(command: string, extra: Record<string, unknown> = {}): CommandClaims {
	return {
		iss: ISSUER,
		aud: ENDPOINT,
		client_id: "test-client",
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + 300,
		jti: crypto.randomUUID(),
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test constructs known command strings
		command: command as CommandClaims["command"],
		tenant: "default",
		...extra,
	};
}

describe("handleCommand", () => {
	let deps: CommandDeps;
	let state: FakeState;

	beforeEach(() => {
		({ deps, state } = makeDeps());
	});

	async function seedUser(sub: string, email = "user@example.com"): Promise<CommandUser> {
		const user = await deps.adapter.createUser({ email, name: "Test User", role: 10 });
		await deps.adapter.createOAuthAccount({
			provider: "hello",
			providerAccountId: sub,
			userId: user.id,
		});
		return user;
	}

	it("answers metadata from config", async () => {
		const res = await handleCommand(claimsFor("metadata"), deps);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.command_endpoint).toBe(ENDPOINT);
		expect(body.client_id).toBe("test-client");
		expect(body.commands_supported).toContain("delete");
		expect(body.context).toEqual({ iss: ISSUER, tenant: "default" });
	});

	it("suspend disables the user; audit reports suspended", async () => {
		const user = await seedUser("sub-1");
		const res = await handleCommand(claimsFor("suspend", { sub: "sub-1" }), deps);
		expect(res.status).toBe(200);
		expect((await res.json()).account_state).toBe("suspended");
		expect(state.users.get(user.id)?.disabled).toBe(true);

		const audit = await handleCommand(claimsFor("audit", { sub: "sub-1" }), deps);
		expect((await audit.json()).account_state).toBe("suspended");
	});

	it("suspending an already-suspended account is 409 incompatible_state", async () => {
		await seedUser("sub-1");
		await handleCommand(claimsFor("suspend", { sub: "sub-1" }), deps);
		const res = await handleCommand(claimsFor("suspend", { sub: "sub-1" }), deps);
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toBe("incompatible_state");
		expect(body.account_state).toBe("suspended");
	});

	it("reactivate re-enables a suspended user", async () => {
		const user = await seedUser("sub-1");
		await handleCommand(claimsFor("suspend", { sub: "sub-1" }), deps);
		const res = await handleCommand(claimsFor("reactivate", { sub: "sub-1" }), deps);
		expect((await res.json()).account_state).toBe("active");
		expect(state.users.get(user.id)?.disabled).toBe(false);
	});

	it("delete removes the user and leaves a tombstone that blocks restore", async () => {
		const user = await seedUser("sub-1");
		const res = await handleCommand(claimsFor("delete", { sub: "sub-1" }), deps);
		expect((await res.json()).account_state).toBe("deleted");
		expect(state.users.has(user.id)).toBe(false);
		expect(state.links.has("hello|sub-1")).toBe(false);

		const restore = await handleCommand(claimsFor("restore", { sub: "sub-1" }), deps);
		expect(restore.status).toBe(409);
		expect((await restore.json()).account_state).toBe("deleted");
	});

	it("unknown account is 400 invalid_request", async () => {
		const res = await handleCommand(claimsFor("audit", { sub: "nope" }), deps);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("invalid_request");
	});

	it("activate provisions a user linked to the sub", async () => {
		const res = await handleCommand(
			claimsFor("activate", { sub: "sub-9", email: "new@example.com", name: "New User" }),
			deps,
		);
		expect(res.status).toBe(200);
		expect((await res.json()).account_state).toBe("active");
		const userId = state.links.get("hello|sub-9");
		expect(userId).toBeDefined();
		expect(state.users.get(userId!)?.email).toBe("new@example.com");
	});

	it("activate for an existing sub or email is 409", async () => {
		await seedUser("sub-1", "taken@example.com");
		const dupeSub = await handleCommand(
			claimsFor("activate", { sub: "sub-1", email: "other@example.com" }),
			deps,
		);
		expect(dupeSub.status).toBe(409);

		const dupeEmail = await handleCommand(
			claimsFor("activate", { sub: "sub-2", email: "taken@example.com" }),
			deps,
		);
		expect(dupeEmail.status).toBe(409);
	});

	it("maintain updates email and name from claims", async () => {
		const user = await seedUser("sub-1");
		const res = await handleCommand(
			claimsFor("maintain", { sub: "sub-1", email: "renamed@example.com", name: "Renamed" }),
			deps,
		);
		expect(res.status).toBe(200);
		expect(state.users.get(user.id)?.email).toBe("renamed@example.com");
		expect(state.users.get(user.id)?.name).toBe("Renamed");
	});

	it("rejects unsupported commands", async () => {
		const res = await handleCommand(claimsFor("migrate", { sub: "sub-1" }), deps);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("unsupported_command");
	});
});
