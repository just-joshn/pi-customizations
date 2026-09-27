import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import { createReducer } from "../src/reduce.ts";
import type { WireEvent } from "../src/sse.ts";

const model: Model = {
	id: "claude-sonnet-4-6",
	name: "Claude Sonnet 4.6",
	api: "claude-subscription-messages",
	provider: "claude-subscription",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200000,
	maxTokens: 64000,
};

function apply(events: WireEvent[]) {
	const reducer = createReducer(model, [{ name: "bash" }]);
	for (const event of events) reducer.apply(event);
	reducer.finish();
	return reducer;
}

test("text and tool calls become pi events with parsed arguments", () => {
	const reducer = apply([
		{ kind: "message_start", usage: { input: 5 }, id: "msg_1" },
		{ kind: "block_start", index: 0, block: { type: "text", text: "" } },
		{ kind: "block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
		{ kind: "block_stop", index: 0 },
		{ kind: "block_start", index: 1, block: { type: "tool_use", id: "toolu_1", name: "Bash", input: {} } },
		{ kind: "block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"command\":\"pwd\"}" } },
		{ kind: "block_stop", index: 1 },
		{ kind: "message_delta", stopReason: "tool_use", usage: { output: 4 } },
		{ kind: "message_stop" },
	]);
	assert.equal(reducer.events[0]?.type, "start");
	assert.equal(reducer.events.at(-1)?.type, "done");
	assert.equal(reducer.output.content[0]?.type === "text" && reducer.output.content[0].text, "ok");
	const tool = reducer.output.content[1];
	assert.equal(tool?.type, "toolCall");
	if (tool?.type !== "toolCall") return;
	assert.equal(tool.name, "bash");
	assert.deepEqual(tool.arguments, { command: "pwd" });
	assert.equal(reducer.output.usage.input, 5);
	assert.equal(reducer.output.usage.output, 4);
	assert.equal(reducer.output.usage.cost.input > 0, true);
	assert.equal(reducer.output.stopReason, "toolUse");
});

test("an unrecognized stop reason is an error, not a successful done", () => {
	const reducer = apply([
		{ kind: "message_start", usage: {} },
		{ kind: "message_delta", stopReason: "refusal", usage: {} },
		{ kind: "message_stop" },
	]);
	assert.equal(reducer.output.stopReason, "error");
	assert.match(reducer.output.errorMessage ?? "", /refusal/);
	assert.equal(reducer.events.some((event) => event.type === "done"), false);
});
