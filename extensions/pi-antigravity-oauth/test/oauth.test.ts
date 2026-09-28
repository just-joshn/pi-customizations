import { createHash } from "node:crypto";
import { createServer } from "node:net";
import type { AuthEvent, AuthPrompt, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
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
			expect(prompt.type).toBe("manual_code");
			return `http://localhost:${config.callbackPort}/oauth-callback?code=abc&state=${authUrl.searchParams.get("state")}`;
		});
		const before = Date.now();
		const credential = await createAntigravityOAuth(config).login(flow.value);
		const authUrl = new URL((flow.events[0] as { url: string }).url);
		expect(authUrl.origin + authUrl.pathname).toBe(`${server.url}/auth`);
		expect(authUrl.searchParams.get("redirect_uri")).toBe(`http://localhost:${config.callbackPort}/oauth-callback`);
		expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authUrl.searchParams.get("access_type")).toBe("offline");
		const form = new URLSearchParams(server.requests.find((request) => request.path === "/token")!.body);
		expect(form.get("grant_type")).toBe("authorization_code");
		expect(form.get("code")).toBe("abc");
		expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(
			authUrl.searchParams.get("code_challenge"),
		);
		expect(server.requests.find((request) => request.path === "/userinfo")!.headers.authorization).toBe("Bearer ya29.first");
		expect(JSON.parse(server.requests.find((request) => request.path.endsWith("loadCodeAssist"))!.body)).toEqual({
			metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
		});
		expect(credential.type).toBe("oauth");
		expect(credential.access).toBe("ya29.first");
		expect(credential.refresh).toBe("1//refresh");
		expect(credential.projectId).toBe("companion-42");
		expect(credential.email).toBe("dev@example.com");
		expect(credential.expires >= before + 3300 * 1000 && credential.expires <= Date.now() + 3300 * 1000).toBe(true);
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
		expect(new URLSearchParams(server.requests.find((request) => request.path === "/token")!.body).get("code")).toBe("xyz");
		expect(credential.projectId).toBe("companion-42");
		expect(promptAborted).toBe(true);
	} finally {
		server.close();
	}
});

test("a pasted redirect with the wrong state is rejected", async () => {
	const server = await google();
	try {
		const config = await endpoints(server);
		const flow = interaction(async () => `http://localhost:${config.callbackPort}/oauth-callback?code=abc&state=forged`);
		await expect(createAntigravityOAuth(config).login(flow.value)).rejects.toThrow("OAuth state mismatch");
		expect(server.requests.length).toBe(0);
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
		expect(form.get("grant_type")).toBe("refresh_token");
		expect(form.get("refresh_token")).toBe("1//refresh");
		expect(refreshed.access).toBe("ya29.refreshed");
		expect(refreshed.refresh).toBe("1//refresh");
		expect(refreshed.projectId).toBe("companion-42");
		expect(refreshed.email).toBe("dev@example.com");
	} finally {
		server.close();
	}
});

test("a failed refresh surfaces Google's error", async () => {
	const server = await fakeServer((_, res) => json(res, 400, { error: "invalid_grant" }));
	try {
		const stored: OAuthCredential = { type: "oauth", access: "a", refresh: "r", expires: 0, projectId: "p" };
		await expect(
			createAntigravityOAuth(await endpoints(server)).refresh(stored, new AbortController().signal),
		).rejects.toThrow('Google token request failed (400): {"error":"invalid_grant"}');
	} finally {
		server.close();
	}
});

test("toAuth encodes the token and project that the stream parses back", async () => {
	const auth = await createAntigravityOAuth().toAuth({ type: "oauth", access: "ya29.x", refresh: "r", expires: 0, projectId: "p1" });
	expect(auth.apiKey).toBe('{"token":"ya29.x","projectId":"p1"}');
	expect(parseApiKey(auth.apiKey)).toEqual({ token: "ya29.x", projectId: "p1" });
});

test("credentials without a project ask for a new login", () => {
	expect(() => parseCredential({ type: "oauth", access: "a", refresh: "r", expires: 0 })).toThrow(
		"Google Antigravity credentials lack a project. Run /login and choose Google Antigravity.",
	);
	expect(() => parseApiKey("not json")).toThrow(
		"Google Antigravity credentials are not readable. Run /login and choose Google Antigravity.",
	);
	expect(() => parseApiKey('{"token":"t"}')).toThrow(
		"Google Antigravity credentials lack a token or project. Run /login and choose Google Antigravity.",
	);
});
