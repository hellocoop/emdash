/**
 * OpenID Provider Commands draft-02 types.
 * https://github.com/openid/openid-provider-commands
 *
 * Kept in sync with @hellocoop/api's Command/CommandClaims.
 */

export type Command =
	// Tenant Commands
	| "metadata"
	| "audit_tenant"
	| "suspend_tenant"
	| "archive_tenant"
	| "delete_tenant"
	| "invalidate_tenant"
	// Account Commands
	| "activate"
	| "maintain"
	| "suspend"
	| "reactivate"
	| "archive"
	| "restore"
	| "delete"
	| "audit"
	| "invalidate"
	| "migrate"
	// Asynchronous Account Commands
	| "activate_async"
	| "maintain_async"
	| "suspend_async"
	| "reactivate_async"
	| "archive_async"
	| "restore_async"
	| "delete_async"
	| "audit_async"
	| "invalidate_async"
	| "migrate_async";

export type CommandClaims = {
	iss: string;
	aud: string;
	client_id: string;
	iat: number;
	exp: number;
	jti: string;
	command: Command;
	tenant: string;
	// present in Account Commands, prohibited in Tenant Commands
	sub?: string;
	aud_sub?: string;
	// profile claims that may accompany Account Commands
	email?: string;
	email_verified?: boolean;
	name?: string;
	given_name?: string;
	family_name?: string;
	groups?: string[];
	roles?: string[];
	// the metadata command carries an OP metadata object
	metadata?: Record<string, unknown>;
	[claim: string]: unknown;
};

export interface CommandIssuer {
	issuer: string;
	/** Discovered via .well-known/openid-configuration when not set. */
	jwks_uri?: string;
	/** Pinned key set (tests, dev issuers unreachable over HTTP). */
	jwks?: { keys: Array<Record<string, unknown>> };
}

export type AccountState = "active" | "suspended" | "archived" | "deleted";

export const COMMANDS_SUPPORTED: Command[] = [
	"metadata",
	"activate",
	"maintain",
	"suspend",
	"reactivate",
	"archive",
	"restore",
	"delete",
	"audit",
	"invalidate",
];
