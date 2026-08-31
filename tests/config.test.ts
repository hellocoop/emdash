import { describe, expect, it } from "vitest";

import { deriveIssuer, matchesAllowedEmails, resolveHelloConfig } from "../src/config.js";

describe("matchesAllowedEmails", () => {
	it("matches exact addresses case-insensitively", () => {
		expect(matchesAllowedEmails("Alice@Example.org", ["alice@example.org"])).toBe(true);
		expect(matchesAllowedEmails("bob@example.org", ["alice@example.org"])).toBe(false);
	});

	it("matches bare domains but not subdomains", () => {
		expect(matchesAllowedEmails("a@example.com", ["example.com"])).toBe(true);
		expect(matchesAllowedEmails("a@mail.example.com", ["example.com"])).toBe(false);
	});

	it("matches wildcard domains including the base and subdomains", () => {
		expect(matchesAllowedEmails("a@example.com", ["*.example.com"])).toBe(true);
		expect(matchesAllowedEmails("a@mail.example.com", ["*.example.com"])).toBe(true);
		expect(matchesAllowedEmails("a@notexample.com", ["*.example.com"])).toBe(false);
	});

	it("denies everything when no patterns are configured", () => {
		expect(matchesAllowedEmails("a@example.com", undefined)).toBe(false);
		expect(matchesAllowedEmails("a@example.com", [])).toBe(false);
	});
});

describe("deriveIssuer", () => {
	it("swaps wallet. for issuer. on the wallet host", () => {
		expect(deriveIssuer("https://wallet.hello.coop")).toBe("https://issuer.hello.coop");
		expect(deriveIssuer("https://wallet.hello-beta.net")).toBe("https://issuer.hello-beta.net");
	});

	it("falls back to the production issuer for non-wallet hosts", () => {
		expect(deriveIssuer("http://localhost:3333")).toBe("https://issuer.hello.coop");
	});
});

describe("resolveHelloConfig", () => {
	it("always includes openid in scopes and dedupes", () => {
		const config = resolveHelloConfig({ scopes: ["email", "email"] });
		expect(config.scopes).toContain("openid");
		expect(config.scopes.filter((s) => s === "email")).toHaveLength(1);
	});

	it("derives the issuer from a wallet override", () => {
		const config = resolveHelloConfig({ wallet: "https://wallet.hello-beta.net/" });
		expect(config.wallet).toBe("https://wallet.hello-beta.net");
		expect(config.issuer).toBe("https://issuer.hello-beta.net");
	});
});
