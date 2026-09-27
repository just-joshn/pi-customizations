import assert from "node:assert/strict";
import test from "node:test";
import { authorizeUrl, parseAuthorizationInput, parseTokenBody, REDIRECT_URI } from "../src/oauth.ts";

test("authorize URL uses the Claude Code client, subscription scopes, and PKCE", () => {
	const url = new URL(authorizeUrl("challenge", "state-1"));
	assert.equal(url.origin + url.pathname, "https://claude.ai/oauth/authorize");
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	assert.equal(url.searchParams.get("code_challenge"), "challenge");
	assert.equal(url.searchParams.get("state"), "state-1");
	assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
	assert.match(url.searchParams.get("scope") ?? "", /user:sessions:claude_code/);
	assert.match(url.searchParams.get("scope") ?? "", /user:inference/);
});

test("authorization paste accepts a redirect URL, a hash pair, and a raw code", () => {
	assert.deepEqual(parseAuthorizationInput("https://localhost/callback?code=abc&state=xyz"), { code: "abc", state: "xyz" });
	assert.deepEqual(parseAuthorizationInput("abc#xyz"), { code: "abc", state: "xyz" });
	assert.deepEqual(parseAuthorizationInput("abc"), { code: "abc" });
});

test("token JSON is rejected unless access, refresh, and expiry are present", () => {
	assert.deepEqual(parseTokenBody({ access_token: "a", refresh_token: "r", expires_in: 3600 }), {
		access_token: "a",
		refresh_token: "r",
		expires_in: 3600,
	});
	assert.throws(() => parseTokenBody({ access_token: "a" }), /refresh_token/);
	assert.throws(() => parseTokenBody("nope"), /not an object/);
});
