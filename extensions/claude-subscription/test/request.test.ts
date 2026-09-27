import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContext, type Model, type Tool } from "@earendil-works/pi-ai";
import { buildMessagesRequest, hasAuthorization, mergeHeaders, messagesUrl } from "../src/request.ts";

function model(overrides: Partial<Model> = {}): Model {
	return {
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6",
		api: "claude-subscription-messages",
		provider: "claude-subscription",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 64000,
		...overrides,
	};
}

function request(overrides: Partial<Parameters<typeof buildMessagesRequest>[0]> = {}) {
	return buildMessagesRequest({
		model: model(),
		context: normalizeContext({
			systemPrompt: "Follow the repo rules.",
			messages: [{ role: "user", content: "hi", timestamp: 1 }],
		}),
		token: "sk-ant-oat-test",
		claudeCodeVersion: "2.1.280",
		...overrides,
	});
}

test("subscription request identifies as Claude Code and uses bearer auth", () => {
	const built = request();
	assert.equal(built.url, "https://api.anthropic.com/v1/messages");
	assert.equal(built.headers.authorization, "Bearer sk-ant-oat-test");
	assert.equal(built.headers["user-agent"], "claude-cli/2.1.280");
	assert.equal(built.headers["x-app"], "cli");
	assert.equal(built.headers["anthropic-version"], "2023-06-01");
	assert.equal(built.headers.accept, "application/json");
	assert.equal(built.headers["content-type"], "application/json");
	assert.match(built.headers["anthropic-beta"], /claude-code-20250219/);
	assert.match(built.headers["anthropic-beta"], /oauth-2025-04-20/);
	assert.equal(built.headers["x-api-key"], undefined);
	assert.equal(built.headers["x-stainless-lang"], undefined);
	assert.equal(Object.values(built.headers).some((value) => value.includes("Anthropic/JS")), false);
	const system = built.body.system as Array<{ text: string }>;
	assert.equal(system[0]?.text, "You are Claude Code, Anthropic's official CLI for Claude.");
	assert.equal(system[1]?.text, "Follow the repo rules.");
	assert.equal(built.body.stream, true);
});

test("a null caller header deletes the Claude Code user agent", () => {
	const headers = mergeHeaders(
		{ "user-agent": "claude-cli/2.1.280", authorization: "Bearer token" },
		{ "User-Agent": null },
	);
	assert.equal(hasAuthorization(headers), true);
	assert.equal(Object.keys(headers).some((name) => name.toLowerCase() === "user-agent"), false);
});

test("tool names use Claude Code casing and tool results stay with the following user turn", () => {
	const tools: Tool[] = [
		{
			name: "bash",
			description: "Run a command",
			parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
		},
	];
	const built = request({
		context: normalizeContext({
			messages: [
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "call 1", name: "bash", arguments: { command: "pwd" } }],
					api: "claude-subscription-messages",
					provider: "claude-subscription",
					model: "claude-sonnet-4-6",
					usage: emptyUsage(),
					stopReason: "toolUse",
					timestamp: 1,
				},
				{
					role: "toolResult",
					toolCallId: "call 1",
					toolName: "bash",
					content: [{ type: "text", text: "/tmp" }],
					isError: false,
					timestamp: 2,
				},
			],
			tools,
		}),
	});
	const messages = built.body.messages as Array<{ role: string; content: Array<{ type: string; name?: string; id?: string }> }>;
	assert.equal(messages[0]?.content[0]?.name, "Bash");
	assert.equal(messages[0]?.content[0]?.id, "call_1");
	assert.equal(messages[1]?.content[0]?.type, "tool_result");
	const wireTools = built.body.tools as Array<{ name: string }>;
	assert.equal(wireTools[0]?.name, "Bash");
	assert.match(built.headers["anthropic-beta"], /fine-grained-tool-streaming-2025-05-14/);
});

test("base URL trailing slash and existing /v1 do not duplicate the messages path", () => {
	assert.equal(messagesUrl("https://api.anthropic.com/"), "https://api.anthropic.com/v1/messages");
	assert.equal(messagesUrl("https://example.test/v1"), "https://example.test/v1/messages");
});

test("budget thinking adds the interleaved beta and keeps the budget under max tokens", () => {
	const built = request({ reasoning: "high", maxTokens: 2000 });
	const thinking = built.body.thinking as { type: string; budget_tokens: number };
	assert.equal(thinking.type, "enabled");
	assert.equal(thinking.budget_tokens < (built.body.max_tokens as number), true);
	assert.match(built.headers["anthropic-beta"], /interleaved-thinking-2025-05-14/);
});

function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
