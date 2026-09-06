# @hellocoop/emdash

[Hellō](https://hello.dev) login for [EmDash](https://github.com/emdash-cms/emdash) — and account lifecycle management via [OpenID Provider Commands](https://openid.net/specs/openid-provider-commands-1_0.html).

One integration gives your EmDash site login with passkeys, email, Google, Apple, Microsoft, GitHub, and 30+ other providers — your users choose, you write no provider-specific code. Hellō can also deprovision accounts it issued: suspend, delete, and audit commands arrive signed at your site and are applied to the matching EmDash user.

## Install

EmDash's marketplace does not list auth providers yet, so there is no plugin to
install from the admin UI. Adding Hellō is an npm install plus one line of
config.

```bash
npm add @hellocoop/emdash
```

The package ships compiled JavaScript and type declarations (`dist/`), so it
needs no build step of your own. It expects `emdash`, `@emdash-cms/auth`,
`astro` 5+ and `react` 18+ from your site — the versions an EmDash site
already has.

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
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

With no `clientId` configured, visit `/_emdash/api/auth/hello/quickstart` to register your site with Hellō Quickstart — it stores the `client_id` for you. Or set it explicitly:

```js
hello({ clientId: "your-hello-client-id" });
```

Hellō clients are public — there is no client secret to manage.

## Configuration

```ts
hello({
	// client_id; falls back to EMDASH_OAUTH_HELLO_CLIENT_ID, HELLO_CLIENT_ID,
	// then the value stored by Quickstart
	clientId: "…",

	// extra scopes beyond openid name email (e.g. "picture")
	scopes: ["picture"],

	// preferred providers shown first in the wallet
	providerHint: ["github", "email"],

	// who may self-provision (beyond the first user, who becomes Admin):
	autoProvision: true,
	allowedEmails: ["*.example.com", "alice@example.org"],
	defaultRole: 10, // 10 Subscriber … 50 Admin

	// OpenID Provider Commands endpoint (default true)
	providerCommands: true,
});
```

Sign-in policy: the first user on a site becomes Admin (setup). After that, an existing linked user can always sign in, a user with the same verified email is auto-linked, and new users are created only when `autoProvision` is on **and** their email matches `allowedEmails`. No allowlist means no self-signup — invite users instead.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /_emdash/api/auth/hello/login` | Start login (authorization code + PKCE). Accepts `?returnTo=/path`. |
| `GET /_emdash/api/auth/hello/callback` | Redirect back from the Hellō Wallet |
| `GET /_emdash/api/auth/hello/quickstart` | Register a client with Hellō Quickstart |
| `POST /_emdash/api/auth/hello/commands` | OpenID Provider Commands endpoint |

## Provider Commands

The commands endpoint verifies each `command_token` (signed by the issuer, `typ: command+jwt`, audience bound to the endpoint URL, single-use `jti`) and applies it to the EmDash user linked to the Hellō `sub`:

| Command | Effect |
| --- | --- |
| `metadata` | Describe this deployment |
| `activate` | Pre-provision a user |
| `maintain` | Sync email / name |
| `suspend` / `reactivate` | Disable / re-enable login |
| `archive` / `restore` | Soft-remove / restore |
| `delete` | Delete the user (tombstoned — the sub cannot sign back in) |
| `audit` | Report account state |
| `invalidate` | Acknowledge session invalidation |

Register `https://your-site/_emdash/api/auth/hello/commands` as the command endpoint for your client in the [Hellō console](https://console.hello.coop).

## Testing against non-production issuers

```ts
hello({
	wallet: "https://wallet.hello-beta.net", // issuer derived automatically
	commandIssuers: [{ issuer: "http://127.0.0.1:3333" }], // e.g. mockin
});
```

## Cutting a release

Publishing runs in GitHub Actions
([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) and
authenticates with npm trusted publishing (OIDC). There is no `NPM_TOKEN`
secret, and nobody publishes from a laptop.

One-time setup on npmjs.com, under the package's **Settings → Trusted
Publisher**:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `hellocoop` |
| Repository | `emdash` |
| Workflow filename | `publish.yml` |
| Environment | *(leave empty)* |
| Allowed actions | permit `npm publish`, not only `npm stage publish` |

Trusted publisher configurations created after 3 September 2026 allow
`npm stage publish` by default; the workflow runs a direct `npm publish`, so
direct publishing has to be ticked as well.

**Provenance requires this repository to be public.** npm rejects a publish
with `--provenance` from a private source repository (HTTP 422, "Only public
source repositories are supported when publishing with provenance"). With the
repository public and a provenance attestation on every version, "Require
provenance" can be turned on for the package on npmjs.com.

To cut a release:

1. Bump `version` in `package.json` on a branch, and merge it to `main`.
2. Create a GitHub release tagged `vX.Y.Z` — for example
   `gh release create v0.1.1 --generate-notes`.
3. The workflow builds, tests, checks that the tag matches `package.json`, and
   publishes. `prepublishOnly` rebuilds `dist/` regardless, so a publish can
   never ship a stale build.

`v0.1.0` was published by hand before this pipeline existed; that tag marks the
exact tree on npm.

## License

MIT
