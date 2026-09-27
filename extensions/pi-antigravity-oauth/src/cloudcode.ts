import { setTimeout as delay } from "node:timers/promises";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { headersToRecord } from "@earendil-works/pi-ai/utils/headers";

export const PROVIDER_ID = "google-antigravity";

export const CLOUD_CODE_ENDPOINTS: readonly string[] = [
	"https://daily-cloudcode-pa.googleapis.com",
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
];

const GO_OS: Partial<Record<NodeJS.Platform, string>> = { win32: "windows" };
const GO_ARCH: Partial<Record<NodeJS.Architecture, string>> = { x64: "amd64", ia32: "386" };

export function userAgent(platform = process.platform, arch = process.arch): string {
	const os = GO_OS[platform] ?? platform;
	const goArch = GO_ARCH[arch] ?? arch;
	return `antigravity/cli/1.1.23 (aidev_client; os_type=${os}; arch=${goArch}; cl=974125021; auth_method=consumer)`;
}

export const USER_AGENT = userAgent();

export interface AntigravityApiKey {
	token: string;
	projectId: string;
}

export function encodeApiKey(key: AntigravityApiKey): string {
	return JSON.stringify({ token: key.token, projectId: key.projectId });
}

export function parseApiKey(raw: string | undefined): AntigravityApiKey {
	const relogin = "Run /login and choose Google Antigravity.";
	if (!raw) throw new Error(`No Google Antigravity credentials. ${relogin}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Google Antigravity credentials are not readable. ${relogin}`);
	}
	const { token, projectId } = (parsed ?? {}) as Partial<Record<keyof AntigravityApiKey, unknown>>;
	if (typeof token !== "string" || !token || typeof projectId !== "string" || !projectId) {
		throw new Error(`Google Antigravity credentials lack a token or project. ${relogin}`);
	}
	return { token, projectId };
}

export function cloudCodeHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"User-Agent": USER_AGENT,
	};
}

export function errorText(body: string): string {
	try {
		const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
		if (typeof message === "string") return message;
	} catch {}
	return body;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function postCloudCode(
	endpoints: readonly string[],
	method: string,
	token: string,
	body: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	let lastError = new Error(`${method} has no endpoint to call`);
	for (const endpoint of endpoints) {
		try {
			const response = await fetch(`${endpoint}/v1internal:${method}`, {
				method: "POST",
				headers: cloudCodeHeaders(token),
				body: JSON.stringify(body),
				signal,
			});
			const text = await response.text();
			if (response.ok) return JSON.parse(text) as unknown;
			lastError = new Error(`${method} failed (${response.status}): ${errorText(text)}`);
		} catch (error) {
			if (signal?.aborted) throw error;
			lastError = error instanceof Error ? error : new Error(String(error));
		}
	}
	throw lastError;
}

export function extractRetryDelay(body: string, headers: Headers): number | undefined {
	const padded = (ms: number) => (ms > 0 ? Math.ceil(ms + 1000) : undefined);
	const retryAfter = headers.get("retry-after");
	if (retryAfter) {
		const seconds = Number(retryAfter);
		const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(retryAfter).getTime() - Date.now();
		if (padded(ms)) return padded(ms);
	}
	const resetAt = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
	if (!Number.isNaN(resetAt) && padded(resetAt * 1000 - Date.now())) return padded(resetAt * 1000 - Date.now());
	const resetAfter = Number(headers.get("x-ratelimit-reset-after") ?? Number.NaN);
	if (Number.isFinite(resetAfter) && padded(resetAfter * 1000)) return padded(resetAfter * 1000);
	const duration = body.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
	if (duration) {
		const [, hours = "0", minutes = "0", seconds = "0"] = duration;
		const ms = ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
		if (padded(ms)) return padded(ms);
	}
	const hinted = body.match(/Please retry in ([0-9.]+)(ms|s)/i) ?? body.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i);
	if (hinted) return padded(Number(hinted[1]) * (hinted[2]!.toLowerCase() === "ms" ? 1 : 1000));
	return undefined;
}

function isRetryable(status: number, body: string): boolean {
	return (
		[429, 500, 502, 503, 504].includes(status) ||
		/resource.?exhausted|rate.?limit|overloaded|service.?unavailable|other.?side.?closed/i.test(body)
	);
}

export async function openStream(
	endpoints: readonly string[],
	init: RequestInit,
	model: Model<Api>,
	options: SimpleStreamOptions | undefined,
): Promise<Response> {
	const signal = options?.signal;
	let endpoint = 0;
	let attempt = 0;
	while (true) {
		let response: Response;
		try {
			response = await fetch(`${endpoints[endpoint]}/v1internal:streamGenerateContent?alt=sse`, init);
		} catch (error) {
			if (signal?.aborted || attempt >= MAX_RETRIES) throw error;
			await delay(BASE_DELAY_MS * 2 ** attempt++, undefined, { signal });
			continue;
		}
		await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
		if (response.ok) return response;
		const body = await response.text();
		if ((response.status === 403 || response.status === 404) && endpoint < endpoints.length - 1) {
			endpoint++;
			continue;
		}
		if (attempt >= MAX_RETRIES || !isRetryable(response.status, body)) {
			throw new Error(`Cloud Code Assist API error (${response.status}): ${errorText(body)}`);
		}
		const serverDelay = extractRetryDelay(body, response.headers);
		const maxDelay = options?.maxRetryDelayMs ?? 60000;
		if (serverDelay && maxDelay > 0 && serverDelay > maxDelay) {
			throw new Error(
				`Server requested ${Math.ceil(serverDelay / 1000)}s retry delay (max: ${Math.ceil(maxDelay / 1000)}s). ${errorText(body)}`,
			);
		}
		if (endpoint < endpoints.length - 1) endpoint++;
		await delay(serverDelay ?? BASE_DELAY_MS * 2 ** attempt, undefined, { signal });
		attempt++;
	}
}
