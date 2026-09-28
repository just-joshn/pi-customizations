import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { createAntigravityCommand, fetchAccountSummary, formatAccountSummary } from "../src/command.ts";
import { fakeServer, json } from "./fake-server.ts";

const API_KEY = JSON.stringify({ token: "ya29.t", projectId: "proj-9" });

async function cloudCode() {
	return fakeServer((request, res) => {
		if (request.path === "/userinfo") return json(res, 200, { email: "dev@example.com" });
		if (request.path === "/v1internal:loadCodeAssist") {
			return json(res, 200, { currentTier: { id: "free-tier", name: "Free" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } });
		}
		return json(res, 200, {
			models: {
				"gemini-3.1-pro-low": { quotaInfo: { remainingFraction: 0.75, resetTime: "2026-01-01T02:30:00Z" } },
				"claude-sonnet-4-6": { quotaInfo: {} },
			},
		});
	});
}

test("the account summary shows email, project, paid tier, and per-model quota", async () => {
	const server = await cloudCode();
	try {
		const summary = await fetchAccountSummary(API_KEY, { cloudCode: [server.url], userInfoUrl: `${server.url}/userinfo` });
		expect(formatAccountSummary(summary, Date.parse("2026-01-01T00:00:00Z"))).toBe(
			[
				"Account: dev@example.com",
				"Project: proj-9",
				"Tier: Google AI Pro (g1-pro-tier)",
				"Quota:",
				"  claude-sonnet-4-6: unknown",
				"  gemini-3.1-pro-low: 75% left, resets in 2h 30m",
			].join("\n"),
		);
	} finally {
		server.close();
	}
});

test("without a UI the command writes plain text to stderr using the registry's refreshed credential", async () => {
	const server = await cloudCode();
	const written: string[] = [];
	const printed: string[] = [];
	try {
		let askedFor = "";
		const ctx = {
			hasUI: false,
			modelRegistry: {
				getApiKeyForProvider: async (provider: string) => {
					askedFor = provider;
					return API_KEY;
				},
			},
		} as unknown as ExtensionCommandContext;
		vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
			if (typeof chunk === "string" && chunk.startsWith("Account:")) {
				written.push(chunk);
			}
			return true;
		}) as typeof process.stderr.write);
		vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
			if (typeof chunk === "string" && chunk.startsWith("Account:")) {
				printed.push(chunk);
			}
			return true;
		}) as typeof process.stdout.write);
		await createAntigravityCommand({ cloudCode: [server.url], userInfoUrl: `${server.url}/userinfo` }).handler("", ctx);
		expect(askedFor).toBe("google-antigravity");
		expect(printed).toEqual([]);
		expect(written.length).toBe(1);
		expect(written[0]).toMatch(/^Account: dev@example.com\nProject: proj-9\nTier: Google AI Pro \(g1-pro-tier\)\nQuota:\n/);
	} finally {
		server.close();
	}
});

test("with a UI and no login the command tells the user to log in", async () => {
	const notes: [string, string | undefined][] = [];
	const ctx = {
		hasUI: true,
		ui: { notify: (message: string, level?: string) => notes.push([message, level]) },
		modelRegistry: { getApiKeyForProvider: async () => undefined },
	} as unknown as ExtensionCommandContext;
	await createAntigravityCommand({ cloudCode: [], userInfoUrl: "" }).handler("", ctx);
	expect(notes).toEqual([["Google Antigravity is not logged in. Run /login and choose Google Antigravity.", "error"]]);
});
