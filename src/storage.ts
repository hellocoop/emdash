/**
 * Auth provider storage accessor.
 *
 * Resolves the hello auth provider's storage collections from the EmDash
 * runtime config, plus a client_id resolver that folds in the value stored
 * by Quickstart.
 */

import type { Kysely } from "kysely";

import { PROVIDER_ID, type HelloAuthConfig, type ResolvedHelloConfig } from "./config.js";

interface AuthProviderDescriptorLike {
	id: string;
	config?: unknown;
	storage?: Record<string, { indexes?: Array<string | string[]> }>;
}

export interface EmdashLocals {
	db: Kysely<unknown>;
	config: { authProviders?: AuthProviderDescriptorLike[] };
}

export interface StorageCollectionLike<T = unknown> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	exists(id: string): Promise<boolean>;
}

export type HelloStorage = {
	states: StorageCollectionLike<{
		nonce: string;
		codeVerifier: string;
		returnTo?: string;
		createdAt: number;
	}>;
	settings: StorageCollectionLike<{ value: string }>;
	accounts: StorageCollectionLike<{ state: string; userId?: string; updatedAt: number }>;
	jti: StorageCollectionLike<{ exp: number }>;
};

export function getHelloProviderConfig(emdash: EmdashLocals): HelloAuthConfig {
	const provider = emdash.config.authProviders?.find((p) => p.id === PROVIDER_ID);
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- provider config is an opaque Record narrowed to the hello config shape
	return (provider?.config ?? {}) as HelloAuthConfig;
}

export async function getHelloStorage(emdash: EmdashLocals): Promise<HelloStorage | null> {
	const { getAuthProviderStorage } = await import("emdash/api/route-utils");
	const provider = emdash.config.authProviders?.find((p) => p.id === PROVIDER_ID);
	if (!provider?.storage) return null;

	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Kysely<unknown> satisfies getAuthProviderStorage's Database parameter; the returned collections match HelloStorage's method surface
	return getAuthProviderStorage(
		emdash.db as unknown as Parameters<typeof getAuthProviderStorage>[0],
		PROVIDER_ID,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- provider.storage shape matches getAuthProviderStorage's expected Record type
		provider.storage as Parameters<typeof getAuthProviderStorage>[2],
	) as unknown as HelloStorage;
}

export const CLIENT_ID_SETTING = "client_id";

/**
 * Resolve the effective client_id: config/env first, then the value
 * Quickstart stored in provider storage.
 */
export async function resolveClientId(
	resolved: ResolvedHelloConfig,
	storage: HelloStorage | null,
): Promise<string | undefined> {
	if (resolved.clientId) return resolved.clientId;
	const stored = await storage?.settings.get(CLIENT_ID_SETTING);
	return stored?.value || undefined;
}
