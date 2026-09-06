/**
 * Deployment events — emitted by this package, delivered by the deployment.
 *
 * This package emits events for logins and OpenID Provider Commands. It does
 * not decide where they go. The deployment does, once, in its own config, by
 * way of an integration that owns the sink — today `aauth({ events:
 * "./src/events.ts" })` from @aauth/emdash. That integration runs a `pre`
 * middleware which places the deployment's handler on Astro's request
 * `locals` as `locals.emdashEvents`. Every route in this package already has
 * `locals`, so emitting is `emit(locals, ...)`. When nothing is registered,
 * `emit` is a no-op.
 *
 * Why request `locals`, and not something else:
 *
 * - Not `hello({ onEvent })` or `hello({ events: "./src/events.ts" })`.
 *   `hello()` returns an EmDash `AuthProviderDescriptor`, whose `config` must
 *   be JSON: core serializes it into the bundle and hands it to routes as
 *   data. A function cannot ride in it, and a module path in it cannot be
 *   bundled — a dynamic `import(string)` at runtime fails in Workers. Only an
 *   Astro integration, running at build time, can wire a module in.
 *
 * - Not a static `import("virtual:emdash-events")` in this package. That is
 *   what we had. The virtual module exists only when the integration that
 *   serves it is in the site's config, and Vite fails the build on any import
 *   it cannot resolve, try/catch or not. A site that installs `hello()` alone
 *   could not build. An emitter must never statically import its sink.
 *
 * - Not depending on @aauth/emdash, or shipping a factory that returns both a
 *   descriptor and an integration. A dependency cannot register a Vite plugin;
 *   only an integration listed in the site's `astro.config` can, and a
 *   descriptor cannot add one. A factory does not help either: descriptors
 *   and integrations go in different config arrays, and `emdash()` reads
 *   `authProviders` when it is constructed, so nothing can inject a descriptor
 *   later. Either way, the site that adds only the descriptor must still
 *   build, which brings us back to "never statically import the sink". It
 *   would also couple Hellō login to AAuth, which is wrong for a site that
 *   wants one and not the other.
 *
 * - Not a `globalThis[Symbol.for("emdash.events")]` registry. It works and is
 *   the usual cross-package-singleton idiom, but it is ambient, untyped at
 *   the call site, and invisible in a route's signature. Astro already has
 *   the mechanism for handing request-scoped services to routes: middleware
 *   sets `locals`, routes read `locals`, and the shape is declared once by
 *   merging into `App.Locals` — exactly how EmDash core exposes its own
 *   handlers as `locals.emdash`. Same mechanism, same typing, no globals, and
 *   trivially testable with a fake `locals`.
 *
 * The long-term home for this is EmDash core (`emdash({ events })` with core
 * emitting its own login and content events too). Until upstream has it, the
 * convention is: the integration that owns the sink sets
 * `locals.emdashEvents`; any library that wants to emit reads it.
 */

export interface EmdashEvent {
	level: "info" | "warn" | "error";
	/** snake_case event type, e.g. "hello_login". */
	event: string;
	message: string;
	data?: Record<string, unknown>;
}

/** Sync or async; the emitter never awaits it and swallows its errors. */
export type EmdashEventHandler = (event: EmdashEvent) => unknown;

/**
 * The slice of Astro `locals` this module reads. Declared structurally so
 * callers can pass real `APIContext["locals"]` or a plain object in tests.
 */
export interface EventsLocals {
	emdashEvents?: EmdashEventHandler | null;
}

/** Fire-and-forget; never throws, never blocks the request path. */
export function emit(
	locals: EventsLocals | undefined,
	level: EmdashEvent["level"],
	event: string,
	message: string,
	data?: Record<string, unknown>,
): void {
	const handler = locals?.emdashEvents;
	if (!handler) return;
	const record: EmdashEvent = { level, event, message, ...(data ? { data } : {}) };
	try {
		void handler(record);
	} catch {
		/* an event sink must never break the request path */
	}
}
