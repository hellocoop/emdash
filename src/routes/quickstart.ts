/**
 * GET /_emdash/api/auth/hello/quickstart
 *
 * Two halves of the Hellō Quickstart flow (client registration without a
 * console):
 *
 * - No ?client_id: initiate — redirect to the Quickstart app with this
 *   route as the response_uri and the callback as the redirect_uri to
 *   register. Allowed when no client_id is configured yet, or for a
 *   logged-in Admin.
 * - ?client_id=...: response — validate the format and store it in provider
 *   storage, only when no client_id is configured (never overwrite; a
 *   configured client_id changes via config or env).
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { Role } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { getPublicOrigin } from "emdash/api/route-utils";

export const GET: APIRoute = async ({ request, locals, session, redirect }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return new Response("Database not configured", { status: 500 });
	}

	try {
		const url = new URL(request.url);
		const baseUrl = getPublicOrigin(url, emdash?.config);

		const { resolveHelloConfig, CLIENT_ID_PATTERN } = await import("../config.js");
		const { getHelloProviderConfig, getHelloStorage, resolveClientId, CLIENT_ID_SETTING } =
			await import("../storage.js");

		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- emdash locals satisfy EmdashLocals shape required by getHelloStorage
		const emdashLocals = emdash as unknown as Parameters<typeof getHelloStorage>[0];
		const config = resolveHelloConfig(getHelloProviderConfig(emdashLocals));
		const storage = await getHelloStorage(emdashLocals);
		if (!storage) {
			return new Response("Hellō provider storage not configured", { status: 500 });
		}

		const configured = await resolveClientId(config, storage);
		const responseClientId = url.searchParams.get("client_id");

		if (responseClientId !== null) {
			// Quickstart response
			if (!CLIENT_ID_PATTERN.test(responseClientId)) {
				return redirect("/_emdash/admin/login?error=hello_quickstart_invalid_client_id");
			}
			if (configured) {
				return redirect("/_emdash/admin/login?error=hello_quickstart_existing_client_id");
			}
			await storage.settings.put(CLIENT_ID_SETTING, { value: responseClientId });
			return redirect("/_emdash/admin/login?message=hello_quickstart_success");
		}

		// Initiation: open when unconfigured (setup), Admin-only once configured
		if (configured) {
			const sessionUser = await session?.get("user");
			if (!sessionUser?.id) {
				return new Response("Not authenticated", { status: 401 });
			}
			// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Database uses Generated<> wrappers incompatible with AuthTables structurally; safe at runtime
			const adapter = createKyselyAdapter(
				emdash.db as unknown as Parameters<typeof createKyselyAdapter>[0],
			);
			const user = await adapter.getUserById(sessionUser.id);
			if (!user || user.role < Role.ADMIN) {
				return new Response("Admin required", { status: 403 });
			}
		}

		const quickstartUrl = new URL(config.quickstart);
		quickstartUrl.searchParams.set("integration", "emdash");
		quickstartUrl.searchParams.set(
			"response_uri",
			`${baseUrl}/_emdash/api/auth/hello/quickstart`,
		);
		quickstartUrl.searchParams.set(
			"redirect_uri",
			`${baseUrl}/_emdash/api/auth/hello/callback`,
		);
		quickstartUrl.searchParams.set("name", new URL(baseUrl).hostname);

		return redirect(quickstartUrl.toString());
	} catch (error) {
		console.error("[hello-auth] Quickstart error:", error);
		return new Response("Quickstart failed", { status: 500 });
	}
};
