/// <reference types="emdash/locals" />

/**
 * `locals.emdashEvents` is set by whichever integration owns the deployment's
 * event sink (today `aauth({ events })` from @aauth/emdash) in a `pre`
 * middleware. This package only reads it — see src/events.ts for why the sink
 * travels on request `locals` rather than through a virtual module, a global
 * registry, or `hello()` config. Declared inline (not imported) so this
 * merges identically with the same declaration in the providing package.
 */
declare global {
	namespace App {
		interface Locals {
			emdashEvents?:
				| ((event: {
						level: "info" | "warn" | "error";
						event: string;
						message: string;
						data?: Record<string, unknown>;
				  }) => unknown)
				| null;
		}
	}
}

export {};
