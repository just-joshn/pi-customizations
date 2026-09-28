import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, vi } from "vitest";
import {
	isContextOverflow,
	normalizeContext,
	type AssistantMessage,
	type Context,
	type Provider,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

function register(): Provider {
	const registered: Provider[] = [];
	extension({ registerProvider: (provider: Provider) => registered.push(provider) } as unknown as ExtensionAPI);
	expect(registered.length).toBe(1);
	return registered[0]!;
}

function frames(events: unknown[]): string {
	return events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

const toolUseStream = frames([
	{ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 10, output_tokens: 0 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } },
	{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"a.txt"}' } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
	{ type: "message_stop" },
]);

interface Exchange {
	headers: IncomingHttpHeaders;
	body: Record<string, unknown>;
	message: AssistantMessage;
}

async function exchange(
	reply: (res: ServerResponse) => void,
	context: Context,
	options: SimpleStreamOptions = {},
): Promise<Exchange> {
	let headers: IncomingHttpHeaders = {};
	let body: Record<string, unknown> = {};
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		headers = req.headers;
		body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		reply(res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const provider = register();
		const model = provider.getModels().find((item) => item.id === "claude-sonnet-4-6")!;
		const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const stream = provider.streamSimple({ ...model, baseUrl }, normalizeContext(context), {
			apiKey: "sk-ant-oat01-test",
			...options,
		});
		const message = await stream.result();
		return { headers, body, message };
	} finally {
		server.close();
	}
}

const readTool = {
	name: "read",
	description: "Read a file",
	parameters: { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] },
};

test("the provider is a separate Claude subscription login over the Anthropic Messages API", () => {
	const provider = register();
	expect(provider.id).toBe("claude-subscription");
	expect(provider.auth.oauth?.name).toBe("Claude subscription (Claude Code)");
	expect(provider.auth.oauth?.isSubscription).toBe(true);
	expect(provider.auth.apiKey).toBeUndefined();
	const sonnet = provider.getModels().find((model) => model.id === "claude-sonnet-4-6");
	expect(sonnet?.provider).toBe("claude-subscription");
	expect(sonnet?.api).toBe("anthropic-messages");
});

test("a request identifies as Claude Code and maps tool names both ways", async () => {
	const { headers, body, message } = await exchange(
		(res) => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(toolUseStream);
		},
		{ systemPrompt: "You are helpful.", tools: [readTool], messages: [{ role: "user", content: "read a", timestamp: 1 }] },
	);
	expect(headers.authorization).toBe("Bearer sk-ant-oat01-test");
	expect(headers["x-api-key"]).toBeUndefined();
	expect(headers["user-agent"]).toBe("claude-cli/2.1.280");
	expect(headers["x-app"]).toBe("cli");
	expect(headers["anthropic-version"]).toBe("2023-06-01");
	expect(headers["anthropic-beta"]).toBe("claude-code-20250219,oauth-2025-04-20");
	expect((body.system as Array<{ text: string }>).map((block) => block.text)).toEqual([
		"x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;",
		"You are Claude Code, Anthropic's official CLI for Claude.",
		"You are helpful.",
	]);
	expect((body.tools as Array<{ name: string }>)[0]?.name).toBe("Read");
	expect(message.stopReason).toBe("toolUse");
	expect(message.content).toEqual([{ type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "a.txt" } }]);
});

test("caller payload hooks see the billing block and CLAUDE_CODE_VERSION sets the user agent", async () => {
	let seenFirstBlock: unknown;
	const { headers, body } = await exchange(
		(res) => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(toolUseStream);
		},
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{
			env: { CLAUDE_CODE_VERSION: "9.9.9" },
			onPayload: (payload) => {
				seenFirstBlock = (payload as { system: unknown[] }).system[0];
				return { ...(payload as object), metadata: { user_id: "replaced" } };
			},
		},
	);
	expect(seenFirstBlock).toEqual({
		type: "text",
		text: "x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;",
	});
	expect(body.metadata).toEqual({ user_id: "replaced" });
	expect(headers["user-agent"]).toBe("claude-cli/9.9.9");
});

test("process.env CLAUDE_CODE_VERSION sets the user agent", async () => {
	vi.stubEnv("CLAUDE_CODE_VERSION", "8.8.8");
	const { headers } = await exchange(
		(res) => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(toolUseStream);
		},
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
	);
	expect(headers["user-agent"]).toBe("claude-cli/8.8.8");
});

test("an overflow response stays recognizable so Pi can compact", async () => {
	const { message } = await exchange(
		(res) => {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 9 tokens > 8 maximum" } }));
		},
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
	);
	expect(message.stopReason).toBe("error");
	expect(isContextOverflow(message, 200000)).toBe(true);
});

test("an aborted request ends as aborted, not as an error", async () => {
	const { message } = await exchange(
		(res) => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(toolUseStream);
		},
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ signal: AbortSignal.abort() },
	);
	expect(message.stopReason).toBe("aborted");
});
