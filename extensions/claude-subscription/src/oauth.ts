import { createServer, type Server } from "node:http";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";

const CLIENT_ID = atob("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

interface TokenBody {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

interface CallbackHandle {
	server: Server;
	wait: () => Promise<{ code: string; state: string } | undefined>;
	cancel: () => void;
}

export function authorizeUrl(challenge: string, state: string): string {
	const params = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {
		if (value.includes("#")) {
			const [code, state] = value.split("#", 2);
			return { code, state };
		}
		if (value.includes("code=")) {
			const params = new URLSearchParams(value);
			return {
				code: params.get("code") ?? undefined,
				state: params.get("state") ?? undefined,
			};
		}
		return { code: value };
	}
}

export function parseTokenBody(value: unknown): TokenBody {
	if (!value || typeof value !== "object") throw new Error("Token response was not an object");
	const body = value as Record<string, unknown>;
	if (typeof body.access_token !== "string" || !body.access_token) {
		throw new Error("Token response missing access_token");
	}
	if (typeof body.refresh_token !== "string" || !body.refresh_token) {
		throw new Error("Token response missing refresh_token");
	}
	if (typeof body.expires_in !== "number") throw new Error("Token response missing expires_in");
	return {
		access_token: body.access_token,
		refresh_token: body.refresh_token,
		expires_in: body.expires_in,
	};
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const verifier = base64url(bytes);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

async function login(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
	interaction.signal.throwIfAborted();
	const { verifier, challenge } = await generatePkce();
	const callback = await startCallback(verifier).catch(() => undefined);
	if (!callback) {
		interaction.notify({
			type: "info",
			message: "Could not open the local callback port. Paste the authorization code after you sign in.",
		});
	}
	interaction.notify({
		type: "auth_url",
		url: authorizeUrl(challenge, verifier),
		instructions: "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
	});
	const manualAbort = new AbortController();
	const onAbort = () => {
		manualAbort.abort();
		callback?.cancel();
	};
	interaction.signal.addEventListener("abort", onAbort, { once: true });
	try {
		const manual = interaction
			.prompt({
				type: "manual_code",
				message: "Complete login in your browser, or paste the authorization code / redirect URL here:",
				placeholder: REDIRECT_URI,
				signal: manualAbort.signal,
			})
			.then((input) => ({ kind: "manual" as const, input }));
		const waited = callback
			? callback.wait().then((result) => ({ kind: "callback" as const, result }))
			: new Promise<never>(() => {});
		const winner = await Promise.race([manual, waited]);
		manualAbort.abort();
		callback?.cancel();
		const parsed = winner.kind === "manual"
			? parseAuthorizationInput(winner.input)
			: { code: winner.result?.code, state: winner.result?.state };
		if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
		if (!parsed.code) throw new Error("Missing authorization code");
		interaction.notify({ type: "progress", message: "Exchanging authorization code for tokens..." });
		return exchange(
			{
				grant_type: "authorization_code",
				client_id: CLIENT_ID,
				code: parsed.code,
				state: parsed.state ?? verifier,
				redirect_uri: REDIRECT_URI,
				code_verifier: verifier,
			},
			interaction.signal,
		);
	} finally {
		interaction.signal.removeEventListener("abort", onAbort);
		manualAbort.abort();
		callback?.server.close();
	}
}

async function refresh(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> {
	return exchange(
		{
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: credential.refresh,
		},
		signal,
	);
}

async function exchange(body: Record<string, string>, signal: AbortSignal): Promise<OAuthCredential> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`Token request failed. status=${response.status}; body=${text.slice(0, 500)}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("Token response was not JSON");
	}
	const tokens = parseTokenBody(parsed);
	return {
		type: "oauth",
		refresh: tokens.refresh_token,
		access: tokens.access_token,
		expires: Date.now() + tokens.expires_in * 1000 - EXPIRY_SKEW_MS,
	};
}

function startCallback(expectedState: string): Promise<CallbackHandle> {
	return new Promise((resolve, reject) => {
		let settle: (value: { code: string; state: string } | undefined) => void = () => {};
		let settled = false;
		const wait = new Promise<{ code: string; state: string } | undefined>((resolveWait) => {
			settle = (value) => {
				if (settled) return;
				settled = true;
				resolveWait(value);
			};
		});
		const server = createServer((req, res) => {
			try {
				const url = new URL(req.url || "", "http://localhost");
				if (url.pathname !== CALLBACK_PATH) {
					send(res, 404, "Callback route not found.");
					return;
				}
				const error = url.searchParams.get("error");
				if (error) {
					send(res, 400, `Anthropic authentication did not complete. Error: ${escapeHtml(error)}`);
					return;
				}
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				if (!code || !state || state !== expectedState) {
					send(res, 400, "Missing code or state mismatch.");
					return;
				}
				send(res, 200, "Anthropic authentication completed. You can close this window.");
				settle({ code, state });
			} catch {
				send(res, 500, "Internal error");
			}
		});
		server.on("error", reject);
		server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
			resolve({ server, wait: () => wait, cancel: () => settle(undefined) });
		});
	});
}

function send(res: import("node:http").ServerResponse, status: number, message: string): void {
	res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
	res.end(`<!doctype html><html><body><p>${message}</p></body></html>`);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export const claudeSubscriptionOAuth: OAuthAuth = {
	name: "Claude subscription (Claude Code)",
	isSubscription: true,
	login,
	refresh,
	async toAuth(credential) {
		return { apiKey: credential.access };
	},
};
