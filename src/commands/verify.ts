/**
 * Command Token verification — OpenID Provider Commands draft-02.
 *
 * Ported from @hellocoop/api's command handler with identical claim checks:
 * typ must be command+jwt, aud must equal the command endpoint URL, iss must
 * be on the allowlist, the baseline claims must be present, and a nonce claim
 * is prohibited (cross-JWT confusion guard).
 */

import {
	createLocalJWKSet,
	createRemoteJWKSet,
	decodeJwt,
	decodeProtectedHeader,
	jwtVerify,
	type JWTVerifyGetKey,
} from "jose";

import type { CommandClaims, CommandIssuer } from "./types.js";

const COMMAND_TOKEN_TYP = "command+jwt";

// claims every Command Token must carry (draft-02 baseline)
const REQUIRED_CLAIMS = ["iss", "aud", "client_id", "iat", "exp", "jti", "command", "tenant"];

export const PRODUCTION_COMMAND_ISSUER: CommandIssuer = {
	issuer: "https://issuer.hello.coop",
	jwks_uri: "https://issuer.hello.coop/.well-known/jwks.json",
};

const jwksCache = new Map<string, JWTVerifyGetKey>();

async function getJWKS(issuer: CommandIssuer): Promise<JWTVerifyGetKey> {
	const cached = jwksCache.get(issuer.issuer);
	if (cached) return cached;

	let getKey: JWTVerifyGetKey;
	if (issuer.jwks) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pinned key sets are caller-supplied JWK objects
		getKey = createLocalJWKSet(issuer.jwks as unknown as Parameters<typeof createLocalJWKSet>[0]);
	} else {
		let jwks_uri = issuer.jwks_uri;
		if (!jwks_uri) {
			const configURL = issuer.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
			const response = await fetch(configURL);
			if (!response.ok) throw new Error(`could not fetch ${configURL}: ${response.status}`);
			const json = (await response.json()) as { jwks_uri?: string };
			if (!json.jwks_uri) throw new Error(`no jwks_uri in ${configURL} response`);
			jwks_uri = json.jwks_uri;
			issuer.jwks_uri = jwks_uri;
		}
		getKey = createRemoteJWKSet(new URL(jwks_uri));
	}
	jwksCache.set(issuer.issuer, getKey);
	return getKey;
}

/** Tests and dev issuers register here; production Hellō is always present. */
export function buildIssuerAllowlist(extra: CommandIssuer[]): Record<string, CommandIssuer> {
	const allowlist: Record<string, CommandIssuer> = {
		[PRODUCTION_COMMAND_ISSUER.issuer]: PRODUCTION_COMMAND_ISSUER,
	};
	for (const issuer of extra) {
		allowlist[issuer.issuer.replace(/\/$/, "")] = issuer;
	}
	return allowlist;
}

export type VerifyResult =
	| { claims: CommandClaims }
	| { status: 400 | 401; error: string; error_description: string };

const invalidRequest = (error_description: string): VerifyResult => ({
	status: 400,
	error: "invalid_request",
	error_description,
});

export async function verifyCommandToken(
	command_token: string,
	commandEndpoint: string,
	issuers: Record<string, CommandIssuer>,
): Promise<VerifyResult> {
	let iss: string | undefined;
	try {
		const header = decodeProtectedHeader(command_token);
		if (header.typ !== COMMAND_TOKEN_TYP)
			return invalidRequest(`"typ" header must be "${COMMAND_TOKEN_TYP}"`);
		iss = decodeJwt(command_token).iss;
	} catch {
		return invalidRequest("malformed command token");
	}
	if (!iss) return invalidRequest("missing iss claim");
	const issuer = issuers[iss];
	if (!issuer) {
		console.error("[hello-commands] unknown issuer", iss);
		return {
			status: 401,
			error: "unrecognized_provider",
			error_description: `unrecognized iss ${iss}`,
		};
	}
	try {
		const jwks = await getJWKS(issuer);
		const { payload } = await jwtVerify(command_token, jwks, {
			issuer: iss,
			audience: commandEndpoint,
			typ: COMMAND_TOKEN_TYP,
			requiredClaims: REQUIRED_CLAIMS,
		});
		if ("nonce" in payload)
			// prohibited to prevent cross-JWT confusion
			return invalidRequest("nonce claim must not be present");
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jwtVerify enforced the baseline claims above
		return { claims: payload as CommandClaims };
	} catch (e) {
		console.error("[hello-commands] verification failed:", e);
		return invalidRequest("command token verification failed");
	}
}
