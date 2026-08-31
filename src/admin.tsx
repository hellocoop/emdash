/**
 * Hellō Auth Provider Admin Components
 *
 * LoginButton for the login page and SetupStep for the setup wizard.
 * Imported at build time via the virtual:emdash/auth-providers module.
 *
 * The Hellō login flow starts with a plain GET redirect, so both components
 * just navigate to the provider's login route.
 */

import { Button } from "@cloudflare/kumo";
import * as React from "react";

const LOGIN_URL = "/_emdash/api/auth/hello/login";

function HelloMark({ className }: { className?: string }) {
	// The Hellō "ō" mark, per the hello-btn brand guidance (hello.dev/docs/buttons)
	return (
		<span className={className} aria-hidden="true" style={{ fontWeight: 700 }}>
			ō
		</span>
	);
}

// ============================================================================
// LoginButton — compact button shown in the provider grid
// ============================================================================

export function LoginButton() {
	return (
		<Button
			type="button"
			variant="outline"
			className="w-full justify-center"
			onClick={() => {
				window.location.href = LOGIN_URL;
			}}
		>
			<HelloMark className="h-5 w-5 text-center" />
			<span>Continue with Hellō</span>
		</Button>
	);
}

// ============================================================================
// SetupStep — shown in the setup wizard to create the admin via Hellō
// ============================================================================

export function SetupStep({ onComplete }: { onComplete: () => void }) {
	// onComplete is called after the redirect back from the wallet
	void onComplete;

	return (
		<div className="space-y-3">
			<div className="text-center mb-2">
				<p className="text-sm font-medium text-kumo-default">Hellō</p>
				<p className="text-xs text-kumo-subtle">
					Sign in with your Hellō Wallet — passkey, email, or any provider you choose
				</p>
			</div>
			<Button
				type="button"
				variant="outline"
				className="w-full"
				onClick={() => {
					window.location.href = LOGIN_URL;
				}}
			>
				<HelloMark className="h-5 w-5 text-center" />
				<span>Continue with Hellō</span>
			</Button>
		</div>
	);
}
