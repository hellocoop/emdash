/// <reference types="emdash/locals" />

declare module "virtual:emdash-events" {
	import type { EmdashEventHandler } from "./events.js";

	export const onEvent: EmdashEventHandler | null;
}
