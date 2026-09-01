/**
 * Pluggable deployment events.
 *
 * This package EMITS events (logins, OPC commands); the DEPLOYMENT decides
 * where they go by providing the shared virtual module
 * `virtual:emdash-events`, whose exported `onEvent(event)` receives every
 * event. Any integration can provide it — today `aauth()` from
 * @aauth/emdash does, via its `events: "./src/events.ts"` config — and the
 * same sink then receives events from every EmDash library following the
 * convention. No provider in the build → `emit` is a no-op.
 *
 * Resolution is a lazy dynamic import so this file also loads outside the
 * Astro build (unit tests, plain node), where the virtual id cannot resolve.
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

let handler: EmdashEventHandler | null | undefined;
let loading: Promise<void> | undefined;

async function resolveHandler(): Promise<void> {
	try {
		const mod = (await import("virtual:emdash-events")) as {
			onEvent?: EmdashEventHandler | null;
		};
		handler = mod.onEvent ?? null;
	} catch {
		handler = null;
	}
}

function deliver(event: EmdashEvent): void {
	if (!handler) return;
	try {
		void handler(event);
	} catch {
		/* an event sink must never break the request path */
	}
}

/** Fire-and-forget; never throws, never blocks the request path. */
export function emit(
	level: EmdashEvent["level"],
	event: string,
	message: string,
	data?: Record<string, unknown>,
): void {
	const record: EmdashEvent = { level, event, message, ...(data ? { data } : {}) };
	if (handler === undefined) {
		loading ??= resolveHandler();
		void loading.then(() => deliver(record));
		return;
	}
	deliver(record);
}

/** Test seam: install a handler (or null); `undefined` re-arms resolution. */
export function setEventHandlerForTesting(h: EmdashEventHandler | null | undefined): void {
	handler = h;
	loading = undefined;
}
