/**
 * Hellō provider configuration.
 *
 * Resolution for endpoints and client_id:
 * - descriptor config wins
 * - then environment (EMDASH_OAUTH_HELLO_CLIENT_ID, HELLO_CLIENT_ID, HELLO_WALLET, HELLO_ISSUER)
 * - client_id only: then the value stored by Quickstart in provider storage
 */

import type { ProviderHint, Scope } from "@hellocoop/definitions";

export const PROVIDER_ID = "hello";

export const DEFAULT_WALLET = "https://wallet.hello.coop";
export const DEFAULT_QUICKSTART = "https://quickstart.hello.coop/";
export const DEFAULT_ISSUER = "https://issuer.hello.coop";

/** Scopes requested when none are configured. */
export const DEFAULT_HELLO_SCOPES: Scope[] = ["openid", "name", "email"];

export interface HelloAuthConfig {
	/**
	 * Hellō client_id. Falls back to EMDASH_OAUTH_HELLO_CLIENT_ID, then
	 * HELLO_CLIENT_ID, then the value stored by Quickstart. Unset → the admin
	 * settings page offers Quickstart.
	 */
	clientId?: string;

	/** Extra Hellō scopes beyond the defaults (openid name email), e.g. ["picture"]. */
	scopes?: Scope[];

	/** Preferred providers passed as provider_hint, e.g. ["github", "email"]. */
	providerHint?: ProviderHint[];

	/** Create an EmDash user on first Hellō login. @default true */
	autoProvision?: boolean;

	/**
	 * Role level for auto-provisioned users: 10 Subscriber … 50 Admin.
	 * The first user on a site always becomes Admin. @default 10
	 */
	defaultRole?: number;

	/**
	 * Restrict login to these emails / wildcard domains, e.g.
	 * ["*.example.com", "alice@example.org"]. Unset → only the first user
	 * (setup) and existing linked/invited users can sign in.
	 */
	allowedEmails?: string[];

	/** Enable the OpenID Provider Commands endpoint. @default true */
	providerCommands?: boolean;

	/** Wallet origin override for hello-beta / hello-dev / mockin testing. */
	wallet?: string;

	/** Issuer override. Defaults to the wallet origin with "wallet." → "issuer.". */
	issuer?: string;

	/** Quickstart origin override. */
	quickstart?: string;

	/**
	 * Additional trusted command issuers (e.g. mockin) as
	 * { issuer, jwks_uri?, jwks? }. https://issuer.hello.coop is always trusted.
	 */
	commandIssuers?: Array<{
		issuer: string;
		jwks_uri?: string;
		jwks?: { keys: Array<Record<string, unknown>> };
	}>;
}

function env(name: string): string | undefined {
	// Secrets/config read process.env per EmDash conventions; guarded for
	// runtimes where process is absent and nodejs_compat is off.
	try {
		return typeof process !== "undefined" ? process.env?.[name] : undefined;
	} catch {
		return undefined;
	}
}

export interface ResolvedHelloConfig {
	clientId?: string;
	scopes: Scope[];
	providerHint?: ProviderHint[];
	autoProvision: boolean;
	defaultRole: number;
	allowedEmails?: string[];
	providerCommands: boolean;
	wallet: string;
	issuer: string;
	quickstart: string;
	commandIssuers: NonNullable<HelloAuthConfig["commandIssuers"]>;
}

export function resolveHelloConfig(config: HelloAuthConfig | undefined): ResolvedHelloConfig {
	const c = config ?? {};
	const wallet = (c.wallet ?? env("HELLO_WALLET") ?? DEFAULT_WALLET).replace(/\/$/, "");
	const issuer = (c.issuer ?? env("HELLO_ISSUER") ?? deriveIssuer(wallet)).replace(/\/$/, "");
	const scopes = Array.from(new Set<Scope>(["openid", ...(c.scopes ?? DEFAULT_HELLO_SCOPES)]));
	return {
		clientId: c.clientId ?? env("EMDASH_OAUTH_HELLO_CLIENT_ID") ?? env("HELLO_CLIENT_ID"),
		scopes,
		providerHint: c.providerHint,
		autoProvision: c.autoProvision ?? true,
		defaultRole: c.defaultRole ?? 10,
		allowedEmails: c.allowedEmails,
		providerCommands: c.providerCommands ?? true,
		wallet,
		issuer,
		quickstart: (c.quickstart ?? env("HELLO_QUICKSTART") ?? DEFAULT_QUICKSTART).replace(/\/$/, ""),
		commandIssuers: c.commandIssuers ?? [],
	};
}

/** Hellō convention: the issuer host is the wallet host with wallet. → issuer. */
export function deriveIssuer(wallet: string): string {
	try {
		const url = new URL(wallet);
		if (url.hostname.startsWith("wallet.")) {
			url.hostname = "issuer." + url.hostname.slice("wallet.".length);
			return url.origin;
		}
	} catch {
		// fall through to production issuer
	}
	return DEFAULT_ISSUER;
}

/**
 * Match an email against the allowedEmails patterns: exact address, bare
 * domain ("example.com"), or wildcard domain ("*.example.com" — the domain
 * and its subdomains).
 */
export function matchesAllowedEmails(email: string, patterns: string[] | undefined): boolean {
	if (!patterns || patterns.length === 0) return false;
	const normalized = email.trim().toLowerCase();
	const at = normalized.lastIndexOf("@");
	if (at < 0) return false;
	const domain = normalized.slice(at + 1);
	return patterns.some((raw) => {
		const p = raw.trim().toLowerCase();
		if (!p) return false;
		if (p.includes("@")) return normalized === p;
		if (p.startsWith("*.")) {
			const base = p.slice(2);
			return domain === base || domain.endsWith("." + base);
		}
		return domain === p;
	});
}

export const CLIENT_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
