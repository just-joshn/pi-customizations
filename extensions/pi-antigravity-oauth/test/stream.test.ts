import assert from "node:assert/strict";
import test from "node:test";
import {
	isContextOverflow,
	isRetryableAssistantError,
	normalizeContext,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createAntigravityProvider } from "../src/index.ts";
import { userAgent } from "../src/cloudcode.ts";
import { GOOGLE_OAUTH } from "../src/oauth.ts";
import type { CloudCodeRequest } from "../src/stream.ts";
import { fakeServer, json, sse, stream, type FakeServer, type Recorded } from "./fake-server.ts";

const API_KEY = JSON.stringify({ token: "ya29.test", projectId: "proj-123" });

const readTool = {
	name: "read",
	description: "Read a file",
	parameters: { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] },
};

const hello: Context = { systemPrompt: "Be brief.", messages: [{ role: "user", content: "hi", timestamp: 1 }] };

const textAndThinking = sse([
	{ response: { responseId: "r1", candidates: [{ content: { parts: [{ text: "Let me think", thought: true, thoughtSignature: "sig1" }] } }] } },
	{ response: { candidates: [{ content: { parts: [{ text: "Hel" }] } }] } },
	{
		response: {
			candidates: [{ content: { parts: [{ text: "lo" }] }, finishReason: "STOP" }],
			usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15 },
		},
	},
]);

function toolCallStream(id: string): string {
	return sse([
		{
			response: {
				candidates: [
					{ content: { parts: [{ functionCall: { id, name: "read", args: { path: "a.txt" } } }] }, finishReason: "STOP" },
				],
			},
		},
	]);
}

interface Run {
	server: FakeServer;
	message: AssistantMessage;
	events: string[];
}

async function run(
	reply: (request: Recorded, res: import("node:http").ServerResponse) => void,
	options: {
		modelId?: string;
		model?: (model: Model<Api>) => Model<Api>;
		context?: Context;
		stream?: SimpleStreamOptions;
		endpoints?: (url: string) => string[];
	} = {},
): Promise<Run> {
	const server = await fakeServer(reply);
	try {
		const endpoints = options.endpoints?.(server.url) ?? [server.url];
		const provider = createAntigravityProvider({ endpoints, oauth: GOOGLE_OAUTH });
		const base = provider.getModels().find((item) => item.id === (options.modelId ?? "gemini-3.1-pro-low"))!;
		const model = options.model?.(base) ?? base;
		const result = provider.streamSimple(model, normalizeContext(options.context ?? hello), {
			apiKey: API_KEY,
			...options.stream,
		});
		const events: string[] = [];
		for await (const event of result) events.push(event.type);
		return { server, message: await result.result(), events };
	} finally {
		server.close();
	}
}

function body(request: Recorded | undefined): CloudCodeRequest {
	return JSON.parse(request!.body) as CloudCodeRequest;
}

test("text and thinking stream into balanced Pi events with usage", async () => {
	const { message, events } = await run((_, res) => stream(res, textAndThinking), { stream: { reasoning: "high" } });
	assert.deepEqual(events, [
		"start",
		"thinking_start",
		"thinking_delta",
		"thinking_end",
		"text_start",
		"text_delta",
		"text_delta",
		"text_end",
		"done",
	]);
	assert.deepEqual(message.content, [
		{ type: "thinking", thinking: "Let me think", thinkingSignature: "sig1" },
		{ type: "text", text: "Hello", textSignature: undefined },
	]);
	assert.equal(message.stopReason, "stop");
	assert.equal(message.responseId, "r1");
	assert.equal(message.usage.input, 10);
	assert.equal(message.usage.output, 5);
	assert.equal(message.usage.totalTokens, 15);
});

test("the envelope names the project, model, and Antigravity agent request type", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking), { stream: { reasoning: "high" } });
	const sent = body(server.requests[0]);
	assert.equal(server.requests[0]!.path, "/v1internal:streamGenerateContent?alt=sse");
	assert.equal(sent.project, "proj-123");
	assert.equal(sent.model, "gemini-3.1-pro-low");
	assert.equal(sent.requestType, "agent");
	assert.equal(sent.userAgent, "antigravity");
	assert.match(sent.requestId, /^agent-[0-9a-f-]{36}$/);
	assert.deepEqual(sent.request.contents, [{ role: "user", parts: [{ text: "hi" }] }]);
	assert.deepEqual(sent.request.systemInstruction, { role: "user", parts: [{ text: "Be brief." }] });
	assert.deepEqual(sent.request.generationConfig?.thinkingConfig, { includeThoughts: true, thinkingLevel: "HIGH" });
});

test("Gemini sends bearer auth and the Antigravity user agent without the Claude beta header", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking));
	const headers = server.requests[0]!.headers;
	assert.equal(headers.authorization, "Bearer ya29.test");
	assert.equal(headers["user-agent"], userAgent());
	assert.equal(headers.accept, "text/event-stream");
	assert.equal(headers["anthropic-beta"], undefined);
});

test("the user agent names the host in Go's os and arch spelling", () => {
	assert.equal(
		userAgent("darwin", "arm64"),
		"antigravity/cli/1.1.23 (aidev_client; os_type=darwin; arch=arm64; cl=974125021; auth_method=consumer)",
	);
	assert.equal(
		userAgent("win32", "x64"),
		"antigravity/cli/1.1.23 (aidev_client; os_type=windows; arch=amd64; cl=974125021; auth_method=consumer)",
	);
});

test("a reasoning Claude model gets the interleaved-thinking beta and a thinking budget", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking), {
		modelId: "claude-sonnet-4-6",
		stream: { reasoning: "medium", maxTokens: 4000 },
	});
	assert.equal(server.requests[0]!.headers["anthropic-beta"], "interleaved-thinking-2025-05-14");
	assert.deepEqual(body(server.requests[0]).request.generationConfig, {
		maxOutputTokens: 12192,
		thinkingConfig: { includeThoughts: true, thinkingBudget: 8192 },
	});
});

test("a non-reasoning Claude model gets no beta header", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking), {
		modelId: "claude-sonnet-4-6",
		model: (model) => ({ ...model, id: "claude-sonnet-4-5", reasoning: false }),
	});
	assert.equal(server.requests[0]!.headers["anthropic-beta"], undefined);
	assert.equal(body(server.requests[0]).request.generationConfig?.thinkingConfig, undefined);
});

async function toolRoundTrip(modelId: string) {
	const first = await run((_, res) => stream(res, toolCallStream("call_1")), {
		modelId,
		context: { tools: [readTool], messages: [{ role: "user", content: "read a", timestamp: 1 }] },
	});
	const followUp: Context = {
		tools: [readTool],
		messages: [
			{ role: "user", content: "read a", timestamp: 1 },
			first.message,
			{
				role: "toolResult",
				toolCallId: "call_1",
				toolName: "read",
				content: [{ type: "text", text: "hello" }],
				isError: false,
				timestamp: 2,
			},
		],
	};
	const second = await run((_, res) => stream(res, textAndThinking), { modelId, context: followUp });
	return { first, sentTools: body(first.server.requests[0]).request.tools, followUp: body(second.server.requests[0]) };
}

test("a Gemini tool call round trip uses parametersJsonSchema and returns the function response", async () => {
	const { first, sentTools, followUp } = await toolRoundTrip("gemini-3.1-pro-low");
	assert.equal(first.message.stopReason, "toolUse");
	assert.deepEqual(first.message.content, [
		{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } },
	]);
	assert.deepEqual(sentTools, [
		{ functionDeclarations: [{ name: "read", description: "Read a file", parametersJsonSchema: readTool.parameters }] },
	]);
	assert.deepEqual(followUp.request.contents.at(-1), {
		role: "user",
		parts: [{ functionResponse: { name: "read", response: { output: "hello" }, id: "call_1" } }],
	});
});

test("a Claude tool call round trip uses OpenAPI parameters and keeps the tool call id", async () => {
	const { first, sentTools, followUp } = await toolRoundTrip("claude-sonnet-4-6");
	assert.equal(first.message.stopReason, "toolUse");
	assert.deepEqual(sentTools, [
		{ functionDeclarations: [{ name: "read", description: "Read a file", parameters: readTool.parameters }] },
	]);
	assert.deepEqual(followUp.request.contents.at(-2), {
		role: "model",
		parts: [{ functionCall: { name: "read", args: { path: "a.txt" }, id: "call_1" } }],
	});
	assert.deepEqual(followUp.request.contents.at(-1), {
		role: "user",
		parts: [{ functionResponse: { name: "read", response: { output: "hello" }, id: "call_1" } }],
	});
});

test("a 404 cascades to the next endpoint without retrying the first", async () => {
	const { server, message } = await run(
		(request, res) => (request.path.startsWith("/daily/") ? json(res, 404, { error: { message: "nope" } }) : stream(res, textAndThinking)),
		{ endpoints: (url) => [`${url}/daily`, `${url}/prod`] },
	);
	assert.deepEqual(
		server.requests.map((request) => request.path),
		["/daily/v1internal:streamGenerateContent?alt=sse", "/prod/v1internal:streamGenerateContent?alt=sse"],
	);
	assert.equal(message.stopReason, "stop");
});

test("a 429 reaches Pi's own retry without a provider retry by default", async () => {
	const { server, message } = await run((_, res) => json(res, 429, { error: { message: "Resource has been exhausted" } }));
	assert.equal(server.requests.length, 1);
	assert.equal(message.stopReason, "error");
	assert.equal(message.errorMessage, "Cloud Code Assist API error (429): Resource has been exhausted");
	assert.equal(isRetryableAssistantError(message), true);
});

test("with retry.provider.maxRetries set, a 429 waits for retry-after and then succeeds", async () => {
	let calls = 0;
	const started = Date.now();
	const { server, message } = await run(
		(_, res) =>
			calls++ === 0
				? json(res, 429, { error: { message: "Resource has been exhausted" } }, { "retry-after": "0.01" })
				: stream(res, textAndThinking),
		{ stream: { maxRetries: 1 } },
	);
	assert.equal(server.requests.length, 2);
	assert.equal(message.stopReason, "stop");
	assert.ok(Date.now() - started >= 1000, "retry-after plus the one second pad elapsed");
});

test("a non-retryable error surfaces the Cloud Code message and stays recognizable as overflow", async () => {
	const { message } = await run((_, res) =>
		json(res, 400, {
			error: { message: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)" },
		}),
	);
	assert.equal(message.stopReason, "error");
	assert.equal(
		message.errorMessage,
		"Cloud Code Assist API error (400): The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
	);
	assert.equal(isContextOverflow(message, 1048576), true);
});

test("an aborted request ends as aborted", async () => {
	const { message, events } = await run((_, res) => stream(res, textAndThinking), {
		stream: { signal: AbortSignal.abort() },
	});
	assert.equal(message.stopReason, "aborted");
	assert.deepEqual(events, ["error"]);
});

test("a stream that closes before a finish reason is an error Pi retries", async () => {
	const { message } = await run((_, res) =>
		stream(res, sse([{ response: { candidates: [{ content: { parts: [{ text: "cut off" }] } }] } }])),
	);
	assert.equal(message.stopReason, "error");
	assert.equal(message.errorMessage, "Cloud Code Assist stream ended without a finish reason");
	assert.equal(isRetryableAssistantError(message), true);
});

test("a supplied fetch implementation carries the request", async () => {
	const urls: string[] = [];
	const { message } = await run((_, res) => stream(res, textAndThinking), {
		stream: { fetch: (input, init) => (urls.push(String(input)), fetch(input, init)) },
	});
	assert.equal(message.stopReason, "stop");
	assert.equal(urls.length, 1);
	assert.match(urls[0]!, /\/v1internal:streamGenerateContent\?alt=sse$/);
});

test("a malformed SSE line is skipped", async () => {
	const { message } = await run((_, res) =>
		stream(res, `data: {not json\n\n${sse([{ response: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] } }])}`),
	);
	assert.deepEqual(message.content, [{ type: "text", text: "ok", textSignature: undefined }]);
	assert.equal(message.stopReason, "stop");
});

test("onPayload sees the envelope and its replacement is what gets sent", async () => {
	let seenProject: unknown;
	const { server } = await run((_, res) => stream(res, textAndThinking), {
		stream: {
			onPayload: (payload) => {
				seenProject = (payload as CloudCodeRequest).project;
				return { ...(payload as CloudCodeRequest), project: "replaced" };
			},
		},
	});
	assert.equal(seenProject, "proj-123");
	assert.equal(body(server.requests[0]).project, "replaced");
});

test("onResponse sees the status before the body is read", async () => {
	const statuses: number[] = [];
	await run((_, res) => stream(res, textAndThinking), {
		stream: { onResponse: (response) => void statuses.push(response.status) },
	});
	assert.deepEqual(statuses, [200]);
});

test("a missing credential asks the user to log in without calling Cloud Code", async () => {
	const { server, message } = await run((_, res) => stream(res, textAndThinking), { stream: { apiKey: undefined } });
	assert.equal(message.stopReason, "error");
	assert.equal(message.errorMessage, "No Google Antigravity credentials. Run /login and choose Google Antigravity.");
	assert.equal(server.requests.length, 0);
});
