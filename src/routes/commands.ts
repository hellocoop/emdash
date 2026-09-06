/**
 * POST /_emdash/api/auth/hello/commands
 *
 * OpenID Provider Commands endpoint (draft-02). Hellō POSTs a
 * form-encoded command_token here; the token is verified (signature via the
 * issuer's JWKS, typ command+jwt, aud = this endpoint's URL, jti replay
 * cache) and the command is applied to the linked EmDash user.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { getPublicOrigin } from "emdash/api/route-utils";
import { emit } from "../events.js";

function oauthError(
	locals: App.Locals,
	status: number,
	error: string,
	error_description?: string,
): Response {
	emit(locals, "warn", "hello_command_rejected", error_description ?? error, { status, error });
	return new Response(
		JSON.stringify({ error, ...(error_description ? { error_description } : {}) }),
		{
			status,
			headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
		},
	);
}

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return oauthError(locals, 500, "server_error");
	}

	try {
		const url = new URL(request.url);
		const baseUrl = getPublicOrigin(url, emdash?.config);
		const commandEndpoint = `${baseUrl}/_emdash/api/auth/hello/commands`;

		const contentType = request.headers.get("Content-Type") ?? "";
		if (!contentType.includes("application/x-www-form-urlencoded")) {
			return oauthError(locals, 
				400,
				"invalid_request",
				"Content-Type must be application/x-www-form-urlencoded",
			);
		}
		const form = new URLSearchParams(await request.text());
		const command_token = form.get("command_token");
		if (!command_token) {
			return oauthError(locals, 400, "invalid_request", "missing command_token");
		}

		const { resolveHelloConfig } = await import("../config.js");
		const { getHelloProviderConfig, getHelloStorage, resolveClientId } =
			await import("../storage.js");
		const { verifyCommandToken, buildIssuerAllowlist } = await import("../commands/verify.js");
		const { handleCommand } = await import("../commands/handler.js");

		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- emdash locals satisfy EmdashLocals shape required by getHelloStorage
		const emdashLocals = emdash as unknown as Parameters<typeof getHelloStorage>[0];
		const config = resolveHelloConfig(getHelloProviderConfig(emdashLocals));
		if (!config.providerCommands) {
			return oauthError(locals, 404, "invalid_request", "provider commands are disabled");
		}
		const storage = await getHelloStorage(emdashLocals);
		if (!storage) {
			return oauthError(locals, 500, "server_error");
		}

		const issuers = buildIssuerAllowlist(config.commandIssuers);
		const result = await verifyCommandToken(command_token, commandEndpoint, issuers);
		if ("error" in result) {
			console.error("[hello-commands] invalid command token:", result);
			return oauthError(locals, result.status, result.error, result.error_description);
		}
		const { claims } = result;

		// jti replay cache — a command token is single-use
		const jtiKey = `${claims.iss}|${claims.jti}`;
		if (await storage.jti.exists(jtiKey)) {
			return oauthError(locals, 400, "invalid_request", "jti already used");
		}
		await storage.jti.put(jtiKey, { exp: claims.exp });

		const clientId = (await resolveClientId(config, storage)) ?? "unknown";
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Database uses Generated<> wrappers incompatible with AuthTables structurally; safe at runtime
		const adapter = createKyselyAdapter(
			emdash.db as unknown as Parameters<typeof createKyselyAdapter>[0],
		);

		const response = await handleCommand(claims, {
			adapter,
			accounts: storage.accounts,
			commandEndpoint,
			clientId,
			defaultRole: config.defaultRole,
		});
		emit(
			locals,
			response.ok ? "info" : "warn",
			"hello_command",
			`${claims.command} → ${response.status}`,
			{
				command: claims.command,
				iss: claims.iss,
				...(claims.tenant ? { tenant: claims.tenant } : {}),
				...(claims.sub ? { sub: claims.sub } : {}),
				status: response.status,
			},
		);
		return response;
	} catch (error) {
		console.error("[hello-commands] error:", error);
		return oauthError(locals, 500, "server_error");
	}
};
