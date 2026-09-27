import assert from "node:assert/strict";
import test from "node:test";
import type { ModelsPublication, Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, { createAntigravityProvider } from "../src/index.ts";
import { FAMILY, familyOf } from "../src/models.ts";
import { GOOGLE_OAUTH } from "../src/oauth.ts";
import { fakeServer, json } from "./fake-server.ts";

const AVAILABLE = {
	models: {
		"gemini-3.1-pro-low": { displayName: "Gemini 3.1 Pro (Low)", supportsThinking: true, quotaInfo: { remainingFraction: 0.8 } },
		"gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)", supportsThinking: true, supportsImages: true },
		"claude-opus-4-6-thinking": { displayName: "Claude Opus 4.6 (Thinking)", supportsThinking: true },
		"gpt-oss-120b-medium": { displayName: "GPT-OSS 120B (Medium)", supportsImages: false },
		"chat_20706": { displayName: "internal chat" },
		"gemini-internal-eval": { displayName: "Eval", isInternal: true },
	},
	defaultAgentModelId: "gemini-3.1-pro-low",
};

function refreshContext(credential: RefreshModelsContext["credential"]): RefreshModelsContext {
	return {
		credential,
		allowNetwork: true,
		signal: new AbortController().signal,
		publish: async (publication: ModelsPublication) => {
			publication.update?.();
			return true;
		},
	};
}

const CREDENTIAL = { type: "oauth" as const, access: "ya29.t", refresh: "r", expires: Date.now() + 60000, projectId: "proj-9" };

test("the extension registers the Google Antigravity subscription provider and command", () => {
	const providers: Provider[] = [];
	const commands: string[] = [];
	extension({
		registerProvider: (provider: Provider) => providers.push(provider),
		registerCommand: (name: string) => commands.push(name),
	} as unknown as ExtensionAPI);
	const [provider] = providers;
	assert.equal(provider?.id, "google-antigravity");
	assert.equal(provider?.name, "Google Antigravity");
	assert.equal(provider?.auth.oauth?.loginLabel, "Sign in with Google (Antigravity)");
	assert.equal(provider?.auth.oauth?.isSubscription, true);
	assert.deepEqual(
		provider?.getModels().map((model) => model.id),
		["gemini-3.1-pro-low", "gemini-3-flash-agent", "claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium"],
	);
	assert.equal(provider?.getModels()[0]?.baseUrl, "https://daily-cloudcode-pa.googleapis.com");
	assert.deepEqual(commands, ["antigravity"]);
});

test("the family registry routes model ids to their wire behavior", () => {
	assert.equal(familyOf("claude-opus-4-6-thinking"), "claude");
	assert.equal(familyOf("gpt-oss-120b-medium"), "gpt-oss");
	assert.equal(familyOf("gemini-pro-agent"), "gemini");
	assert.deepEqual(
		[FAMILY.gemini.toolParameters, FAMILY.claude.toolParameters, FAMILY["gpt-oss"].toolParameters],
		[false, true, false],
	);
	assert.deepEqual([FAMILY.gemini.thinking, FAMILY.claude.thinking, FAMILY["gpt-oss"].thinking], ["level", "budget", "none"]);
});

test("fetchModels overlays fetchAvailableModels onto the baseline", async () => {
	const server = await fakeServer((_, res) => json(res, 200, AVAILABLE));
	try {
		const provider = createAntigravityProvider({ endpoints: [server.url], oauth: GOOGLE_OAUTH });
		await provider.refreshModels!(refreshContext(CREDENTIAL));
		assert.equal(server.requests[0]!.path, "/v1internal:fetchAvailableModels");
		assert.deepEqual(JSON.parse(server.requests[0]!.body), { project: "proj-9" });
		assert.equal(server.requests[0]!.headers.authorization, "Bearer ya29.t");
		assert.deepEqual(
			provider.getModels().map((model) => model.id),
			[
				"gemini-3.1-pro-low",
				"gemini-3-flash-agent",
				"claude-sonnet-4-6",
				"claude-opus-4-6-thinking",
				"gpt-oss-120b-medium",
				"gemini-3.8-flash-high",
			],
		);
		const flash = provider.getModels().find((model) => model.id === "gemini-3.8-flash-high");
		assert.deepEqual(flash, {
			id: "gemini-3.8-flash-high",
			name: "Gemini 3.8 Flash (High) (Antigravity)",
			api: "cloud-code-assist",
			provider: "google-antigravity",
			baseUrl: server.url,
			reasoning: true,
			thinkingLevelMap: undefined,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		});
		const pro = provider.getModels().find((model) => model.id === "gemini-3.1-pro-low");
		assert.equal(pro?.name, "Gemini 3.1 Pro Low (Antigravity)");
		assert.deepEqual(pro?.cost, { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.375 });
	} finally {
		server.close();
	}
});

test("a failed fetchAvailableModels keeps the baseline", async () => {
	const server = await fakeServer((_, res) => json(res, 403, { error: { message: "denied" } }));
	try {
		const provider = createAntigravityProvider({ endpoints: [server.url], oauth: GOOGLE_OAUTH });
		await assert.rejects(provider.refreshModels!(refreshContext(CREDENTIAL)), {
			message: "fetchAvailableModels failed (403): denied",
		});
		assert.equal(provider.getModels().length, 5);
	} finally {
		server.close();
	}
});
