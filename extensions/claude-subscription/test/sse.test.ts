import assert from "node:assert/strict";
import test from "node:test";
import { parseWireEvent, takeSseEvents } from "../src/sse.ts";

test("SSE frames split across chunks reassemble before parsing", () => {
	const frame = `event: content_block_delta\ndata: ${JSON.stringify({
		type: "content_block_delta",
		index: 0,
		delta: { type: "text_delta", text: "hi" },
	})}\n\n`;
	const first = takeSseEvents(frame.slice(0, 12));
	assert.equal(first.events.length, 0);
	const second = takeSseEvents(first.rest + frame.slice(12));
	assert.equal(second.events.length, 1);
	assert.equal(second.events[0]?.kind, "block_delta");
});

test("malformed data becomes an error event instead of throwing", () => {
	const parsed = takeSseEvents("data: {not-json}\n\n");
	assert.deepEqual(parsed.events[0], { kind: "error", message: "Malformed stream event" });
});

test("message usage keeps the one-hour cache write split", () => {
	const event = parseWireEvent(
		JSON.stringify({
			type: "message_start",
			message: {
				id: "msg_1",
				usage: {
					input_tokens: 3,
					output_tokens: 1,
					cache_read_input_tokens: 2,
					cache_creation_input_tokens: 4,
					cache_creation: { ephemeral_1h_input_tokens: 4 },
				},
			},
		}),
	);
	assert.equal(event.kind, "message_start");
	if (event.kind !== "message_start") return;
	assert.deepEqual(event.usage, {
		input: 3,
		output: 1,
		cacheRead: 2,
		cacheWrite: 4,
		cacheWrite1h: 4,
	});
});
