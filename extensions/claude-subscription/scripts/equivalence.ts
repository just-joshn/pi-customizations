import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { normalizeContext, type Context, type Provider, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

type Reply = (res: ServerResponse) => void;

interface Scenario {
	name: string;
	modelId: string;
	context: Context;
	options?: SimpleStreamOptions;
	reply: Reply;
}

const registered: Provider[] = [];
extension({ registerProvider: (provider: Provider) => registered.push(provider) } as unknown as ExtensionAPI);
const provider = registered[0];
if (!provider) throw new Error("extension registered no provider");

const frames = (events: unknown[]) =>
	events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const sse = (events: unknown[]): Reply => (res) => {
	res.writeHead(200, { "content-type": "text/event-stream" });
	res.end(frames(events));
};

const start = { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-6", usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } } };
const stop = (reason: string) => [
	{ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 7 } },
	{ type: "message_stop" },
];
const text = (value: string) => [
	start,
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: value } },
	{ type: "content_block_stop", index: 0 },
	...stop("end_turn"),
];

const readTool = {
	name: "read",
	description: "Read a file",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};
const user = (content: string) => ({ role: "user" as const, content, timestamp: 1 });

const scenarios: Scenario[] = [
	{
		name: "text with system prompt and tools",
		modelId: "claude-sonnet-4-6",
		context: { systemPrompt: "You are helpful.", tools: [readTool], messages: [user("hi")] },
		reply: sse(text("hello")),
	},
	{
		name: "tool call maps Claude Code names back",
		modelId: "claude-sonnet-4-6",
		context: { systemPrompt: "SYS", tools: [readTool], messages: [user("read a")] },
		reply: sse([
			start,
			{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } },
			{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":' } },
			{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"a.txt"}' } },
			{ type: "content_block_stop", index: 0 },
			...stop("tool_use"),
		]),
	},
	{
		name: "tool result history",
		modelId: "claude-sonnet-4-6",
		context: {
			systemPrompt: "SYS",
			tools: [readTool],
			messages: [
				user("read a"),
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "a.txt" } }],
					api: "anthropic-messages",
					provider: "claude-subscription",
					model: "claude-sonnet-4-6",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "toolUse",
					timestamp: 2,
				},
				{ role: "toolResult", toolCallId: "toolu_1", toolName: "read", content: [{ type: "text", text: "contents" }], isError: false, timestamp: 3 },
			],
		},
		reply: sse(text("done")),
	},
	{
		name: "adaptive thinking",
		modelId: "claude-sonnet-4-6",
		context: { messages: [user("think")] },
		options: { reasoning: "medium" },
		reply: sse([
			start,
			{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
			{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
			{ type: "content_block_stop", index: 1 },
			...stop("end_turn"),
		]),
	},
	{
		name: "budget thinking",
		modelId: "claude-haiku-4-5",
		context: { messages: [user("think")] },
		options: { reasoning: "low", maxTokens: 4000 },
		reply: sse(text("ok")),
	},
	{
		name: "max tokens",
		modelId: "claude-sonnet-4-6",
		context: { messages: [user("long")] },
		reply: sse([...text("cut").slice(0, 4), ...stop("max_tokens")]),
	},
	{
		name: "multibyte split across chunks",
		modelId: "claude-sonnet-4-6",
		context: { messages: [user("hi")] },
		reply: (res) => {
			const bytes = new TextEncoder().encode(frames(text("caf\u00e9")));
			const split = bytes.indexOf(0xc3) + 1;
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(bytes.subarray(0, split));
			setTimeout(() => res.end(bytes.subarray(split)), 15);
		},
	},
	{
		name: "context overflow",
		modelId: "claude-sonnet-4-6",
		context: { messages: [user("hi")] },
		reply: (res) => {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 9 tokens > 8 maximum" } }));
		},
	},
	{
		name: "mid-stream error event",
		modelId: "claude-sonnet-4-6",
		context: { messages: [user("hi")] },
		reply: sse([start, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]),
	},
	{
		name: "aborted before send",
		modelId: "claude-sonnet-4-6",
		context: { messages: [user("hi")] },
		options: { signal: AbortSignal.abort() },
		reply: sse(text("late")),
	},
	{
		name: "onPayload replacement and CLAUDE_CODE_VERSION",
		modelId: "claude-sonnet-4-6",
		context: { messages: [user("hi")] },
		options: {
			env: { CLAUDE_CODE_VERSION: "9.9.9" },
			onPayload: (payload) => ({ ...(payload as object), metadata: { user_id: "replaced" } }),
		},
		reply: sse(text("ok")),
	},
];

interface Captured {
	headers?: IncomingHttpHeaders;
	body?: unknown;
	requests: number;
}

async function run(scenario: Scenario) {
	const captured: Captured = { requests: 0 };
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		captured.requests++;
		captured.headers = req.headers;
		captured.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		scenario.reply(res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	try {
		const model = provider!.getModels().find((item) => item.id === scenario.modelId);
		if (!model) throw new Error(`missing model ${scenario.modelId}`);
		const responses: number[] = [];
		const stream = provider!.streamSimple({ ...model, baseUrl }, normalizeContext(scenario.context), {
			apiKey: "sk-ant-oat01-test",
			onResponse: (response) => {
				responses.push(response.status);
			},
			...scenario.options,
		});
		const events: string[] = [];
		let final: unknown;
		for await (const event of stream) {
			events.push(event.type);
			if (event.type === "done") final = event.message;
			if (event.type === "error") final = event.error;
		}
		const { timestamp: _t, ...message } = final as Record<string, unknown>;
		return { name: scenario.name, requests: captured.requests, responses, request: shapeRequest(captured), events, message };
	} finally {
		server.close();
	}
}

function shapeRequest(captured: Captured) {
	if (!captured.headers) return undefined;
	const identity = ["authorization", "x-api-key", "anthropic-version", "anthropic-beta", "user-agent", "x-app", "content-type", "accept", "anthropic-dangerous-direct-browser-access"];
	const headers = Object.fromEntries(identity.map((name) => [name, captured.headers?.[name]]));
	const stainless = Object.keys(captured.headers).filter((name) => name.startsWith("x-stainless-")).sort();
	return { headers, stainless, body: captured.body };
}

async function missingToken() {
	const model = provider!.getModels()[0]!;
	try {
		const stream = provider!.streamSimple(model, normalizeContext({ messages: [user("hi")] }), {});
		const events = [];
		for await (const event of stream) events.push(event.type === "error" ? { type: "error", errorMessage: event.error.errorMessage } : event.type);
		return { name: "missing token", threw: false, events };
	} catch (error) {
		return { name: "missing token", threw: true, message: (error as Error).message };
	}
}

const results = [];
for (const scenario of scenarios) results.push(await run(scenario));
results.push(await missingToken());
const models = provider.getModels().map((model) => ({ id: model.id, api: model.api, provider: model.provider, compat: model.compat }));
console.log(JSON.stringify({ provider: { id: provider.id, name: provider.name, oauth: provider.auth.oauth?.name, isSubscription: provider.auth.oauth?.isSubscription }, models, results }, null, 2));
