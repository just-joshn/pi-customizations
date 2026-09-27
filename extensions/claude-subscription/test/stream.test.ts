import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { normalizeContext, type Model } from "@earendil-works/pi-ai";
import { streamSubscription } from "../src/stream.ts";

const model: Model = {
	id: "claude-sonnet-4-6",
	name: "Claude Sonnet 4.6",
	api: "claude-subscription-messages",
	provider: "claude-subscription",
	baseUrl: "http://127.0.0.1",
	reasoning: false,
	input: ["text"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200000,
	maxTokens: 64000,
};

function sse(events: unknown[]): string {
	return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function textStream(text: string): string {
	return sse([
		{ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 2, output_tokens: 0 } } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
		{ type: "message_stop" },
	]);
}

async function listen(handler: (req: import("node:http").IncomingMessage, body: string, res: import("node:http").ServerResponse) => void) {
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		handler(req, Buffer.concat(chunks).toString("utf8"), res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;
	return {
		server,
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}

test("missing subscription token throws before a stream is returned", () => {
	assert.throws(
		() => streamSubscription(model, normalizeContext({ messages: [] }), {}),
		/Could not resolve authentication method/,
	);
});

test("the built stream posts Claude Code headers and emits text from the server", async () => {
	let seenHeaders: import("node:http").IncomingHttpHeaders | undefined;
	let seenBody = "";
	const harness = await listen((req, body, res) => {
		seenHeaders = req.headers;
		seenBody = body;
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.end(textStream("hello"));
	});
	try {
		const localModel = { ...model, baseUrl: harness.baseUrl };
		let payloadSeen = false;
		let responseStatus = 0;
		const stream = streamSubscription(localModel, normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] }), {
			apiKey: "sk-ant-oat-test",
			onPayload: () => {
				payloadSeen = true;
			},
			onResponse: (response) => {
				responseStatus = response.status;
			},
		});
		const events = [];
		for await (const event of stream) events.push(event);
		assert.equal(payloadSeen, true);
		assert.equal(responseStatus, 200);
		assert.equal(seenHeaders?.authorization, "Bearer sk-ant-oat-test");
		assert.equal(seenHeaders?.["user-agent"], "claude-cli/2.1.280");
		assert.equal(seenHeaders?.["x-app"], "cli");
		assert.equal(seenHeaders?.["anthropic-version"], "2023-06-01");
		assert.match(String(seenHeaders?.["anthropic-beta"]), /claude-code-20250219/);
		assert.equal(seenHeaders?.["x-api-key"], undefined);
		assert.equal(JSON.parse(seenBody).model, "claude-sonnet-4-6");
		assert.equal(events[0]?.type, "start");
		assert.equal(events.at(-1)?.type, "done");
		const done = events.at(-1);
		assert.equal(done?.type === "done" && done.message.content[0]?.type === "text" && done.message.content[0].text, "hello");
	} finally {
		await harness.close();
	}
});

test("a multibyte character split across response chunks survives decoding", async () => {
	const frame = textStream("caf\u00e9");
	const bytes = new TextEncoder().encode(frame);
	const split = bytes.indexOf(0xc3);
	const harness = await listen((_req, _body, res) => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.write(bytes.subarray(0, split + 1));
		setTimeout(() => {
			res.end(bytes.subarray(split + 1));
		}, 15);
	});
	try {
		const stream = streamSubscription(
			{ ...model, baseUrl: harness.baseUrl },
			normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] }),
			{ apiKey: "sk-ant-oat-test" },
		);
		const events = [];
		for await (const event of stream) events.push(event);
		const done = events.at(-1);
		assert.equal(done?.type === "done" && done.message.content[0]?.type === "text" && done.message.content[0].text, "caf\u00e9");
	} finally {
		await harness.close();
	}
});

test("overflow and abort stay distinct from a successful stop", async () => {
	const overflow = await listen((_req, _body, res) => {
		res.writeHead(400, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "prompt is too long: 9 tokens > 8 maximum" } }));
	});
	try {
		const stream = streamSubscription(
			{ ...model, baseUrl: overflow.baseUrl },
			normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] }),
			{ apiKey: "sk-ant-oat-test" },
		);
		const events = [];
		for await (const event of stream) events.push(event);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.type, "error");
		assert.match(events[0]?.type === "error" ? events[0].error.errorMessage ?? "" : "", /prompt is too long/);
	} finally {
		await overflow.close();
	}

	const controller = new AbortController();
	controller.abort();
	const aborted = await listen((_req, _body, res) => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.end(textStream("late"));
	});
	try {
		const stream = streamSubscription(
			{ ...model, baseUrl: aborted.baseUrl },
			normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] }),
			{ apiKey: "sk-ant-oat-test", signal: controller.signal },
		);
		const events = [];
		for await (const event of stream) events.push(event);
		assert.equal(events[0]?.type, "error");
		assert.equal(events[0]?.type === "error" && events[0].reason, "aborted");
	} finally {
		await aborted.close();
	}
});
