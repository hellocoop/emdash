# Hellō for EmDash — Architecture

`@hellocoop/emdash` adds "Continue with Hellō" login to an [EmDash](https://github.com/emdash-cms/emdash) site, and gives Hellō the ability to manage those accounts — including deprovisioning — via [OpenID Provider Commands](https://openid.net/specs/openid-provider-commands-1_0.html) (OPC).

EmDash is Cloudflare's MIT-licensed, TypeScript CMS built on Astro, deployed on Workers + D1 + R2. This package is the EmDash equivalent of the [`hello-login` WordPress plugin](https://github.com/hellocoop/wordpress), rebuilt for EmDash's auth model.

- **Repo:** `hellocoop/emdash`
- **npm:** `@hellocoop/emdash` (matches `@hellocoop/nextjs`, `@hellocoop/express`, …)
- **License:** MIT (matches the other `@hellocoop/*` packages and the EmDash ecosystem)

## Why an auth provider, not a marketplace plugin

EmDash has two extension surfaces:

1. **Sandboxed plugins** (`definePlugin()`), installed one-click from the marketplace/registry and run in isolated Dynamic Workers. Their capability model is read-only for users (`users:read`) — a sandboxed plugin cannot create a session, create a user, or delete one. Login cannot be built here.
2. **Auth providers** (`AuthProviderDescriptor`), npm packages wired into `astro.config.mjs` via `emdash({ authProviders: [...] })`. Their routes are ordinary Astro `APIRoute`s running in-process with full database access. This is how `@emdash-cms/auth-atproto` (Atmosphere login) and Cloudflare Access SSO are built.

Hellō login is an auth provider. OPC also lives in the provider: it needs to suspend and delete users, which only in-process code can do (there are also no user-lifecycle hooks in EmDash's hook reference to build on).

## Installation (target developer experience)

```bash
npm add @hellocoop/emdash
```

```js
// astro.config.mjs
import emdash from "emdash/astro";
import { hello } from "@hellocoop/emdash";

export default defineConfig({
  integrations: [
    emdash({
      authProviders: [hello()],
    }),
  ],
});
```

With no `clientId` configured, the admin settings panel offers Quickstart to register one. Hellō clients are public — there is no client secret to manage.

## Provider descriptor

`hello(config)` returns an `AuthProviderDescriptor` (type exported from `emdash`), modeled on [`@emdash-cms/auth-atproto`](https://github.com/emdash-cms/emdash/blob/main/packages/auth-atproto/src/auth.ts):

```ts
export function hello(config?: HelloAuthConfig): AuthProviderDescriptor {
  return {
    id: "hello",
    label: "Hellō",
    config: config ?? {},
    adminEntry: "@hellocoop/emdash/admin",
    routes: [
      { pattern: "/_emdash/api/auth/hello/login",      entrypoint: "@hellocoop/emdash/routes/login.ts" },
      { pattern: "/_emdash/api/auth/hello/callback",   entrypoint: "@hellocoop/emdash/routes/callback.ts" },
      { pattern: "/_emdash/api/auth/hello/quickstart", entrypoint: "@hellocoop/emdash/routes/quickstart.ts" },
      { pattern: "/_emdash/api/auth/hello/commands",   entrypoint: "@hellocoop/emdash/routes/commands.ts" },
    ],
    publicRoutes: ["/_emdash/api/auth/hello/"],
    storage: {
      states: { indexes: [] },        // login state + PKCE verifier, short TTL
      subjects: { indexes: ["sub"] }, // Hellō sub → EmDash user id
      jti: { indexes: [] },           // OPC replay cache
    },
  };
}
```

### Configuration

```ts
export interface HelloAuthConfig {
  /** Hellō client_id. Falls back to EMDASH_OAUTH_HELLO_CLIENT_ID, then HELLO_CLIENT_ID. Unset → Quickstart. */
  clientId?: string;
  /** Extra Hellō scopes beyond the defaults: openid name email. e.g. ["picture"] */
  scopes?: string[];
  /** Preferred providers passed as provider_hint, e.g. ["github", "email"]. */
  providerHint?: string[];
  /** Create an EmDash user on first Hellō login. @default true */
  autoProvision?: boolean;
  /** Link a Hellō login to an existing EmDash user with the same verified email. @default true */
  linkExistingUsers?: boolean;
  /** Role level for auto-provisioned users: 10 Subscriber … 50 Admin. @default 10 */
  defaultRole?: number;
  /** Restrict login to these emails / wildcard domains, e.g. ["*.example.com"]. */
  allowedEmails?: string[];
  /** Enable the OPC command endpoint. @default true */
  providerCommands?: boolean;
}
```

Endpoint URLs (`https://wallet.hello.coop/authorize`, `https://wallet.hello.coop/oauth/token`, `https://quickstart.hello.coop/`, issuer `https://issuer.hello.coop`) come from `@hellocoop/definitions` and are overridable via env for hello-dev / hello-beta / [mockin](https://github.com/hellocoop/mockin) testing.

## Login flow

Standard OIDC authorization code flow with PKCE, implemented with `@hellocoop/helper-server` (`createAuthRequest`, `fetchToken`, `parseToken` — all Workers-compatible). This is an upgrade over the WordPress plugin, which uses a plain code flow without PKCE or nonce.

1. **`GET /login`** — `createAuthRequest()` builds the authorization URL (`response_type=code`, `code_challenge`, `state`, `nonce`, scopes, optional `provider_hint`); state + PKCE verifier + nonce stored in the `states` collection with a 10-minute TTL; redirect to `wallet.hello.coop/authorize`. Accepts `?returnTo=` for post-login redirect (same-origin only).
2. **`GET /callback`** — validate `state`, exchange the code with `fetchToken()` (PKCE verifier, no client secret), verify the ID token (`iss`, `aud` = client_id, `nonce`, `exp`). Claims come from the ID token; no userinfo call.
3. **Resolve the user**, in order:
   - `subjects` record for this `sub` → existing EmDash user.
   - Logged-in EmDash session → link current user to this `sub` (error if the user is already linked to a different `sub`).
   - `linkExistingUsers` and a verified email match → link that user.
   - `autoProvision` → create a user via the EmDash auth tables (`@emdash-cms/auth/adapters/kysely`) at `defaultRole`. Per EmDash convention the first user on a site becomes Admin (with the same concurrent-callback guard auth-atproto uses).
   - Otherwise → "no account" error page.
4. **Session** — `session.set("user", { id })`, exactly as core providers do. EmDash owns sessions; the provider never sets its own cookies.

Hellō login coexists with EmDash's passkey-first auth: users can hold both a passkey and a Hellō link.

## Quickstart

`GET /quickstart` (admin-only) redirects to `https://quickstart.hello.coop/` with `response_uri=/_emdash/api/auth/hello/quickstart` and prefilled app metadata, following the flow proven in the WordPress plugin (`quickstart_callback`). On return, the `client_id` (validated `/^[a-z0-9_-]{1,64}$/`) is stored via the provider's options storage — only if not already configured. Redirect URIs for the site are registered by Quickstart automatically.

## OpenID Provider Commands

`POST /_emdash/api/auth/hello/commands` — the site's OPC command endpoint, registered with Hellō so the provider can manage accounts it issued: offboard a user, revoke sessions, or audit state, without the user visiting the site.

### Token verification

Reuses the draft-02 command handler from `@hellocoop/api` ([`packages-js/api/src/handlers/command.ts`](https://github.com/hellocoop/packages-js)) and its `Command` / `CommandClaims` / `CommandHandler` types. The handler is transport-thin (form-encoded `command_token` in, JSON out) so it drops into an Astro route:

- Body `application/x-www-form-urlencoded`, single `command_token` field.
- JWT `typ: "command+jwt"`; `aud` must equal the command endpoint URL; `iss` checked against a configured allowlist (`https://issuer.hello.coop` by default); required claims `iss, aud, client_id, iat, exp, jti, command, tenant`; any `nonce` rejected (cross-JWT confusion guard).
- Signature verified against the issuer's JWKS (jose `createRemoteJWKSet`, cached); algorithms pinned to `RS256`/`ES256`/`EdDSA`.
- `jti` replay cache in the provider's `jti` storage collection, TTL ≥ token lifetime.
- OAuth-style errors: `{ error, error_description }` with 400/401/405/409.

Unlike the WordPress plugin's event receiver, every command token's signature is verified.

### Commands supported (v1)

| Command | Effect on the EmDash user |
|---|---|
| `metadata` | Returns `commands_supported`, `command_endpoint`, `client_id`, context — answered by the shared handler from config |
| `activate` | Pre-provision a user from the command's profile claims (email, name); returns the account reference |
| `maintain` | Update profile claims on the linked user |
| `suspend` / `reactivate` | Disable / re-enable login (suspended users fail auth checks) |
| `archive` / `restore` | Soft-remove / restore the account |
| `delete` | Delete the EmDash user; content authorship handling follows EmDash's user-deletion semantics |
| `invalidate` | Revoke the user's active sessions |
| `audit` | Return current account state |

State-machine semantics (e.g. `409 incompatible_state` with the current `account_state` when a transition is invalid) follow the [opcrp.dev](https://github.com/hellocoop/opcrp) test RP, which is also the conformance target.

## Distribution and discovery

- **Install path:** npm + one line of config, same as `@emdash-cms/auth-atproto`. The EmDash marketplace and AT-Protocol-based registry currently distribute sandboxed plugins only; auth providers are not listed there yet. Watch item — list `@hellocoop/emdash` the day providers are supported.
- **EmDash docs:** docs.emdashcms.com has per-provider guide pages (`/guides/atmosphere-auth/` is the precedent). PR a "Hellō Login" guide page — this is where EmDash users look for login options.
- **Naming:** EmDash prescribes no prefix; scoped packages are the convention (`@emdash-cms/auth-<provider>` first-party). GitHub topic `emdash` for discovery.
- **Hellō channels:** hello.dev docs page alongside the WordPress integration; launch post on blog.hello.coop (which will itself run this package — see the blog migration plan in `HelloCoop/blog`).

## Testing

- **Local:** trusted-mode dev against `wallet.hello.coop` (works on localhost — Hellō requires no pre-registered localhost redirect) or [mockin](https://github.com/hellocoop/mockin) for CI.
- **OPC:** command tests follow `@hellocoop/api`'s `tests/command.test.ts` patterns (local JWK issuer registered in the issuer allowlist); state-machine behavior cross-checked against opcrp.
- **E2E:** Playwright, as in the WordPress plugin's `tests/e2e/`.

## Open questions / watch items

- **EmDash is v0.x.** `AuthProviderDescriptor`, `emdash/api/route-utils`, and the kysely auth adapter are young interfaces; pin versions and track releases.
- **Generic OIDC upstream.** EmDash ships `github`/`google` OAuth providers but no generic OIDC provider. Upstreaming one (`emdash/auth/providers/oidc`) would benefit the ecosystem; `@hellocoop/emdash` would remain the batteries-included Hellō package (Quickstart, provider_hint, OPC).
- **OPC spec tracking.** The handler tracks draft-02; revisit at each draft until final.
- **Invites.** The WordPress plugin integrates `wallet.hello.coop/invite`; deferred here until there's demand.
