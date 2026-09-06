/**
 * Hellō Authentication Provider for EmDash
 *
 * Config-time function that returns an AuthProviderDescriptor for use in
 * astro.config.mjs. When configured, EmDash adds Hellō as a login option
 * alongside passkey and any other configured auth providers, and (unless
 * disabled) serves an OpenID Provider Commands endpoint so Hellō can manage
 * the accounts it issued — suspend, delete, audit — without the user
 * visiting the site.
 *
 * @example
 * ```ts
 * import { hello } from "@hellocoop/emdash";
 *
 * export default defineConfig({
 *   integrations: [
 *     emdash({
 *       authProviders: [hello({ clientId: "your-hello-client-id" })],
 *     }),
 *   ],
 * });
 * ```
 */

import type { AuthProviderDescriptor } from "emdash";

import type { HelloAuthConfig } from "./config.js";

export type { HelloAuthConfig } from "./config.js";

export function hello(config?: HelloAuthConfig): AuthProviderDescriptor {
	return {
		id: "hello",
		label: "Hellō",
		config: config ?? {},
		adminEntry: "@hellocoop/emdash/admin",
		routes: [
			{
				pattern: "/_emdash/api/auth/hello/login",
				entrypoint: "@hellocoop/emdash/routes/login",
			},
			{
				pattern: "/_emdash/api/auth/hello/callback",
				entrypoint: "@hellocoop/emdash/routes/callback",
			},
			{
				pattern: "/_emdash/api/auth/hello/quickstart",
				entrypoint: "@hellocoop/emdash/routes/quickstart",
			},
			...(config?.providerCommands === false
				? []
				: [
						{
							pattern: "/_emdash/api/auth/hello/commands",
							entrypoint: "@hellocoop/emdash/routes/commands",
						},
					]),
		],
		publicRoutes: ["/_emdash/api/auth/hello/"],
		storage: {
			// login state + PKCE verifier + nonce, single-use, short-lived
			states: { indexes: [] },
			// Quickstart-provided client_id and other provider settings
			settings: { indexes: [] },
			// OPC account lifecycle state, keyed by Hellō sub
			accounts: { indexes: [] },
			// OPC command-token jti replay cache
			jti: { indexes: [] },
		},
	};
}
