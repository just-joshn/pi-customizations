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
import { expect, test } from "vitest";
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
	expect(events).toEqual([
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
	expect(message.content).toEqual([
		{ type: "thinking", thinking: "Let me think", thinkingSignature: "sig1" },
		{ type: "text", text: "Hello", textSignature: undefined },
	]);
	expect(message.stopReason).toBe("stop");
	expect(message.responseId).toBe("r1");
	expect(message.usage.input).toBe(10);
	expect(message.usage.output).toBe(5);
	expect(message.usage.totalTokens).toBe(15);
});

test("the envelope names the project, model, and Antigravity agent request type", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking), { stream: { reasoning: "high" } });
	const sent = body(server.requests[0]);
	expect(server.requests[0]!.path).toBe("/v1internal:streamGenerateContent?alt=sse");
	expect(sent.project).toBe("proj-123");
	expect(sent.model).toBe("gemini-3.1-pro-low");
	expect(sent.requestType).toBe("agent");
	expect(sent.userAgent).toBe("antigravity");
	expect(sent.requestId).toMatch(/^agent-[0-9a-f-]{36}$/);
	expect(sent.request.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
	expect(sent.request.systemInstruction).toEqual({ role: "user", parts: [{ text: "Be brief." }] });
	expect(sent.request.generationConfig?.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "HIGH" });
});

test("Gemini sends bearer auth and the Antigravity user agent without the Claude beta header", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking));
	const headers = server.requests[0]!.headers;
	expect(headers.authorization).toBe("Bearer ya29.test");
	expect(headers["user-agent"]).toBe(userAgent());
	expect(headers.accept).toBe("text/event-stream");
	expect(headers["anthropic-beta"]).toBeUndefined();
});

test("the user agent names the host in Go's os and arch spelling", () => {
	expect(userAgent("darwin", "arm64")).toBe(
		"antigravity/cli/1.1.23 (aidev_client; os_type=darwin; arch=arm64; cl=974125021; auth_method=consumer)",
	);
	expect(userAgent("win32", "x64")).toBe(
		"antigravity/cli/1.1.23 (aidev_client; os_type=windows; arch=amd64; cl=974125021; auth_method=consumer)",
	);
});

test("a reasoning Claude model gets the interleaved-thinking beta and a thinking budget", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking), {
		modelId: "claude-sonnet-4-6",
		stream: { reasoning: "medium", maxTokens: 4000 },
	});
	expect(server.requests[0]!.headers["anthropic-beta"]).toBe("interleaved-thinking-2025-05-14");
	expect(body(server.requests[0]).request.generationConfig).toEqual({
		maxOutputTokens: 12192,
		thinkingConfig: { includeThoughts: true, thinkingBudget: 8192 },
	});
});

test("a non-reasoning Claude model gets no beta header", async () => {
	const { server } = await run((_, res) => stream(res, textAndThinking), {
		modelId: "claude-sonnet-4-6",
		model: (model) => ({ ...model, id: "claude-sonnet-4-5", reasoning: false }),
	});
	expect(server.requests[0]!.headers["anthropic-beta"]).toBeUndefined();
	expect(body(server.requests[0]).request.generationConfig?.thinkingConfig).toBeUndefined();
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
	expect(first.message.stopReason).toBe("toolUse");
	expect(first.message.content).toEqual([
		{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } },
	]);
	expect(sentTools).toEqual([
		{ functionDeclarations: [{ name: "read", description: "Read a file", parametersJsonSchema: readTool.parameters }] },
	]);
	expect(followUp.request.contents.at(-1)).toEqual({
		role: "user",
		parts: [{ functionResponse: { name: "read", response: { output: "hello" }, id: "call_1" } }],
	});
});

test("a Claude tool call round trip uses OpenAPI parameters and keeps the tool call id", async () => {
	const { first, sentTools, followUp } = await toolRoundTrip("claude-sonnet-4-6");
	expect(first.message.stopReason).toBe("toolUse");
	expect(sentTools).toEqual([
		{ functionDeclarations: [{ name: "read", description: "Read a file", parameters: readTool.parameters }] },
	]);
	expect(followUp.request.contents.at(-2)).toEqual({
		role: "model",
		parts: [{ functionCall: { name: "read", args: { path: "a.txt" }, id: "call_1" } }],
	});
	expect(followUp.request.contents.at(-1)).toEqual({
		role: "user",
		parts: [{ functionResponse: { name: "read", response: { output: "hello" }, id: "call_1" } }],
	});
});

test("a 404 cascades to the next endpoint without retrying the first", async () => {
	const { server, message } = await run(
		(request, res) => (request.path.startsWith("/daily/") ? json(res, 404, { error: { message: "nope" } }) : stream(res, textAndThinking)),
		{ endpoints: (url) => [`${url}/daily`, `${url}/prod`] },
	);
	expect(server.requests.map((request) => request.path)).toEqual([
		"/daily/v1internal:streamGenerateContent?alt=sse",
		"/prod/v1internal:streamGenerateContent?alt=sse",
	]);
	expect(message.stopReason).toBe("stop");
});

test("a 429 reaches Pi's own retry without a provider retry by default", async () => {
	const { server, message } = await run((_, res) => json(res, 429, { error: { message: "Resource has been exhausted" } }));
	expect(server.requests.length).toBe(1);
	expect(message.stopReason).toBe("error");
	expect(message.errorMessage).toBe("Cloud Code Assist API error (429): Resource has been exhausted");
	expect(isRetryableAssistantError(message)).toBe(true);
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
	expect(server.requests.length).toBe(2);
	expect(message.stopReason).toBe("stop");
	expect(Date.now() - started >= 1000).toBe(true);
});

test("a non-retryable error surfaces the Cloud Code message and stays recognizable as overflow", async () => {
	const { message } = await run((_, res) =>
		json(res, 400, {
			error: { message: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)" },
		}),
	);
	expect(message.stopReason).toBe("error");
	expect(message.errorMessage).toBe(
		"Cloud Code Assist API error (400): The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
	);
	expect(isContextOverflow(message, 1048576)).toBe(true);
});

test("an aborted request ends as aborted", async () => {
	const { message, events } = await run((_, res) => stream(res, textAndThinking), {
		stream: { signal: AbortSignal.abort() },
	});
	expect(message.stopReason).toBe("aborted");
	expect(events).toEqual(["error"]);
});

test("a stream that closes before a finish reason is an error Pi retries", async () => {
	const { message } = await run((_, res) =>
		stream(res, sse([{ response: { candidates: [{ content: { parts: [{ text: "cut off" }] } }] } }])),
	);
	expect(message.stopReason).toBe("error");
	expect(message.errorMessage).toBe("Cloud Code Assist stream ended without a finish reason");
	expect(isRetryableAssistantError(message)).toBe(true);
});

test("a supplied fetch implementation carries the request", async () => {
	const urls: string[] = [];
	const { message } = await run((_, res) => stream(res, textAndThinking), {
		stream: { fetch: (input, init) => (urls.push(String(input)), fetch(input, init)) },
	});
	expect(message.stopReason).toBe("stop");
	expect(urls.length).toBe(1);
	expect(urls[0]).toMatch(/\/v1internal:streamGenerateContent\?alt=sse$/);
});

test("a malformed SSE line is skipped", async () => {
	const { message } = await run((_, res) =>
		stream(res, `data: {not json\n\n${sse([{ response: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] } }])}`),
	);
	expect(message.content).toEqual([{ type: "text", text: "ok", textSignature: undefined }]);
	expect(message.stopReason).toBe("stop");
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
	expect(seenProject).toBe("proj-123");
	expect(body(server.requests[0]).project).toBe("replaced");
});

test("onResponse sees the status before the body is read", async () => {
	const statuses: number[] = [];
	await run((_, res) => stream(res, textAndThinking), {
		stream: { onResponse: (response) => void statuses.push(response.status) },
	});
	expect(statuses).toEqual([200]);
});

test("a missing credential asks the user to log in without calling Cloud Code", async () => {
	const { server, message } = await run((_, res) => stream(res, textAndThinking), { stream: { apiKey: undefined } });
	expect(message.stopReason).toBe("error");
	expect(message.errorMessage).toBe("No Google Antigravity credentials. Run /login and choose Google Antigravity.");
	expect(server.requests.length).toBe(0);
});
