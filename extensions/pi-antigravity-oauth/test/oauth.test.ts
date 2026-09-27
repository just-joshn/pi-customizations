import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import type { AuthEvent, AuthPrompt, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { parseApiKey } from "../src/cloudcode.ts";
import { createAntigravityOAuth, parseCredential, type OAuthEndpoints } from "../src/oauth.ts";
import { fakeServer, json, type FakeServer } from "./fake-server.ts";

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	await new Promise((resolve) => server.close(resolve));
	return port;
}

async function google(): Promise<FakeServer> {
	return fakeServer((request, res) => {
		if (request.path === "/token") {
			const form = new URLSearchParams(request.body);
			if (form.get("grant_type") === "refresh_token") {
				json(res, 200, { access_token: "ya29.refreshed", expires_in: 3600 });
			} else {
				json(res, 200, { access_token: "ya29.first", refresh_token: "1//refresh", expires_in: 3600 });
			}
		} else if (request.path === "/userinfo") {
			json(res, 200, { email: "dev@example.com" });
		} else if (request.path === "/cc/v1internal:loadCodeAssist") {
			json(res, 200, { cloudaicompanionProject: { id: "companion-42" } });
		} else {
			json(res, 404, {});
		}
	});
}

async function endpoints(server: FakeServer): Promise<OAuthEndpoints> {
	return {
		authUrl: `${server.url}/auth`,
		tokenUrl: `${server.url}/token`,
		userInfoUrl: `${server.url}/userinfo`,
		cloudCode: [`${server.url}/cc`],
		callbackHost: "127.0.0.1",
		callbackPort: await freePort(),
	};
}

function interaction(answer: (authUrl: URL, prompt: AuthPrompt) => Promise<string>): {
	value: ProviderAuthInteraction;
	events: AuthEvent[];
} {
	const events: AuthEvent[] = [];
	return {
		events,
		value: {
			signal: new AbortController().signal,
			notify: (event) => events.push(event),
			prompt: (prompt) => {
				const authEvent = events.find((event) => event.type === "auth_url");
				return answer(new URL(authEvent?.type === "auth_url" ? authEvent.url : ""), prompt);
			},
		},
	};
}

test("login with a pasted redirect exchanges the code with PKCE and discovers the project", async () => {
	const server = await google();
	try {
		const config = await endpoints(server);
		const flow = interaction(async (authUrl, prompt) => {
			assert.equal(prompt.type, "manual_code");
			return `http://localhost:${config.callbackPort}/oauth-callback?code=abc&state=${authUrl.searchParams.get("state")}`;
		});
		const before = Date.now();
		const credential = await createAntigravityOAuth(config).login(flow.value);
		const authUrl = new URL((flow.events[0] as { url: string }).url);
		assert.equal(authUrl.origin + authUrl.pathname, `${server.url}/auth`);
		assert.equal(authUrl.searchParams.get("redirect_uri"), `http://localhost:${config.callbackPort}/oauth-callback`);
		assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
		assert.equal(authUrl.searchParams.get("access_type"), "offline");
		const form = new URLSearchParams(server.requests.find((request) => request.path === "/token")!.body);
		assert.equal(form.get("grant_type"), "authorization_code");
		assert.equal(form.get("code"), "abc");
		assert.equal(
			createHash("sha256").update(form.get("code_verifier")!).digest("base64url"),
			authUrl.searchParams.get("code_challenge"),
		);
		assert.equal(server.requests.find((request) => request.path === "/userinfo")!.headers.authorization, "Bearer ya29.first");
		assert.deepEqual(JSON.parse(server.requests.find((request) => request.path.endsWith("loadCodeAssist"))!.body), {
			metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
		});
		assert.equal(credential.type, "oauth");
		assert.equal(credential.access, "ya29.first");
		assert.equal(credential.refresh, "1//refresh");
		assert.equal(credential.projectId, "companion-42");
		assert.equal(credential.email, "dev@example.com");
		assert.ok(credential.expires >= before + 3300 * 1000 && credential.expires <= Date.now() + 3300 * 1000);
	} finally {
		server.close();
	}
});

test("login through the browser callback cancels the manual prompt", async () => {
	const server = await google();
	try {
		const config = await endpoints(server);
		let promptAborted = false;
		const flow = interaction(
			(authUrl, prompt) =>
				new Promise((_, reject) => {
					prompt.signal?.addEventListener("abort", () => {
						promptAborted = true;
						reject(new Error("prompt cancelled"));
					});
					const state = authUrl.searchParams.get("state");
					void fetch(`http://127.0.0.1:${config.callbackPort}/oauth-callback?code=xyz&state=${state}`);
				}),
		);
		const credential = await createAntigravityOAuth(config).login(flow.value);
		assert.equal(new URLSearchParams(server.requests.find((request) => request.path === "/token")!.body).get("code"), "xyz");
		assert.equal(credential.projectId, "companion-42");
		assert.equal(promptAborted, true);
	} finally {
		server.close();
	}
});

test("a pasted redirect with the wrong state is rejected", async () => {
	const server = await google();
	try {
		const config = await endpoints(server);
		const flow = interaction(async () => `http://localhost:${config.callbackPort}/oauth-callback?code=abc&state=forged`);
		await assert.rejects(createAntigravityOAuth(config).login(flow.value), { message: "OAuth state mismatch" });
		assert.equal(server.requests.length, 0);
	} finally {
		server.close();
	}
});

test("refresh keeps the refresh token and project when Google omits a new refresh token", async () => {
	const server = await google();
	try {
		const stored: OAuthCredential = {
			type: "oauth",
			access: "ya29.old",
			refresh: "1//refresh",
			expires: 0,
			projectId: "companion-42",
			email: "dev@example.com",
		};
		const refreshed = await createAntigravityOAuth(await endpoints(server)).refresh(stored, new AbortController().signal);
		const form = new URLSearchParams(server.requests[0]!.body);
		assert.equal(form.get("grant_type"), "refresh_token");
		assert.equal(form.get("refresh_token"), "1//refresh");
		assert.equal(refreshed.access, "ya29.refreshed");
		assert.equal(refreshed.refresh, "1//refresh");
		assert.equal(refreshed.projectId, "companion-42");
		assert.equal(refreshed.email, "dev@example.com");
	} finally {
		server.close();
	}
});

test("a failed refresh surfaces Google's error", async () => {
	const server = await fakeServer((_, res) => json(res, 400, { error: "invalid_grant" }));
	try {
		const stored: OAuthCredential = { type: "oauth", access: "a", refresh: "r", expires: 0, projectId: "p" };
		await assert.rejects(createAntigravityOAuth(await endpoints(server)).refresh(stored, new AbortController().signal), {
			message: 'Google token request failed (400): {"error":"invalid_grant"}',
		});
	} finally {
		server.close();
	}
});

test("toAuth encodes the token and project that the stream parses back", async () => {
	const auth = await createAntigravityOAuth().toAuth({ type: "oauth", access: "ya29.x", refresh: "r", expires: 0, projectId: "p1" });
	assert.equal(auth.apiKey, '{"token":"ya29.x","projectId":"p1"}');
	assert.deepEqual(parseApiKey(auth.apiKey), { token: "ya29.x", projectId: "p1" });
});

test("credentials without a project ask for a new login", () => {
	assert.throws(() => parseCredential({ type: "oauth", access: "a", refresh: "r", expires: 0 }), {
		message: "Google Antigravity credentials lack a project. Run /login and choose Google Antigravity.",
	});
	assert.throws(() => parseApiKey("not json"), {
		message: "Google Antigravity credentials are not readable. Run /login and choose Google Antigravity.",
	});
	assert.throws(() => parseApiKey('{"token":"t"}'), {
		message: "Google Antigravity credentials lack a token or project. Run /login and choose Google Antigravity.",
	});
});
