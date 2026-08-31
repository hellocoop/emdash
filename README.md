# @hellocoop/emdash

[Hellō](https://hello.dev) login for [EmDash](https://github.com/emdash-cms/emdash) — and account lifecycle management via [OpenID Provider Commands](https://openid.net/specs/openid-provider-commands-1_0.html).

One integration gives your EmDash site login with passkeys, email, Google, Apple, Microsoft, GitHub, and 30+ other providers — your users choose, you write no provider-specific code. Hellō can also deprovision accounts it issued: suspend, delete, and audit commands arrive signed at your site and are applied to the matching EmDash user.

## Install

```bash
npm add @hellocoop/emdash
```

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

## License

MIT
