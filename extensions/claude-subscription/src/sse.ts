export interface UsageFields {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cacheWrite1h?: number;
}

export type WireBlock =
	| { type: "text"; text?: string }
	| { type: "thinking"; thinking?: string }
	| { type: "redacted_thinking"; data?: string }
	| { type: "tool_use"; id?: string; name?: string; input?: unknown };

export type WireDelta =
	| { type: "text_delta"; text: string }
	| { type: "thinking_delta"; thinking: string }
	| { type: "signature_delta"; signature: string }
	| { type: "input_json_delta"; partial_json: string };

export type WireEvent =
	| { kind: "message_start"; id?: string; model?: string; usage: UsageFields }
	| { kind: "block_start"; index: number; block: WireBlock }
	| { kind: "block_delta"; index: number; delta: WireDelta }
	| { kind: "block_stop"; index: number }
	| { kind: "message_delta"; stopReason?: string; usage: UsageFields }
	| { kind: "message_stop" }
	| { kind: "ping" }
	| { kind: "error"; message: string }
	| { kind: "ignore" };

export function takeSseEvents(buffer: string): { events: WireEvent[]; rest: string } {
	const parts = buffer.split(/\r?\n\r?\n/);
	const rest = parts.pop() ?? "";
	const events: WireEvent[] = [];
	for (const part of parts) {
		const data = part
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""))
			.join("\n");
		if (!data || data === "[DONE]") continue;
		events.push(parseWireEvent(data));
	}
	return { events, rest };
}

export function parseWireEvent(data: string): WireEvent {
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return { kind: "error", message: "Malformed stream event" };
	}
	if (!value || typeof value !== "object") return { kind: "error", message: "Malformed stream event" };
	const event = value as Record<string, unknown>;
	switch (event.type) {
		case "message_start":
			return messageStart(event.message);
		case "content_block_start":
			return {
				kind: "block_start",
				index: numberField(event.index),
				block: wireBlock(event.content_block),
			};
		case "content_block_delta":
			return {
				kind: "block_delta",
				index: numberField(event.index),
				delta: wireDelta(event.delta),
			};
		case "content_block_stop":
			return { kind: "block_stop", index: numberField(event.index) };
		case "message_delta":
			return {
				kind: "message_delta",
				stopReason: stopReason(event.delta),
				usage: usageFields(event.usage),
			};
		case "message_stop":
			return { kind: "message_stop" };
		case "ping":
			return { kind: "ping" };
		case "error":
			return { kind: "error", message: errorMessage(event.error) };
		default:
			return { kind: "ignore" };
	}
}

function messageStart(message: unknown): WireEvent {
	if (!message || typeof message !== "object") return { kind: "message_start", usage: {} };
	const body = message as Record<string, unknown>;
	return {
		kind: "message_start",
		id: typeof body.id === "string" ? body.id : undefined,
		model: typeof body.model === "string" ? body.model : undefined,
		usage: usageFields(body.usage),
	};
}

function wireBlock(value: unknown): WireBlock {
	if (!value || typeof value !== "object") return { type: "text", text: "" };
	const block = value as Record<string, unknown>;
	if (block.type === "thinking") return { type: "thinking", thinking: stringField(block.thinking) };
	if (block.type === "redacted_thinking") return { type: "redacted_thinking", data: stringField(block.data) };
	if (block.type === "tool_use") {
		return {
			type: "tool_use",
			id: stringField(block.id),
			name: stringField(block.name),
			input: block.input,
		};
	}
	return { type: "text", text: stringField(block.text) };
}

function wireDelta(value: unknown): WireDelta {
	if (!value || typeof value !== "object") return { type: "text_delta", text: "" };
	const delta = value as Record<string, unknown>;
	if (delta.type === "thinking_delta") return { type: "thinking_delta", thinking: stringField(delta.thinking) };
	if (delta.type === "signature_delta") return { type: "signature_delta", signature: stringField(delta.signature) };
	if (delta.type === "input_json_delta") return { type: "input_json_delta", partial_json: stringField(delta.partial_json) };
	return { type: "text_delta", text: stringField(delta.text) };
}

export function usageFields(value: unknown): UsageFields {
	if (!value || typeof value !== "object") return {};
	const usage = value as Record<string, unknown>;
	const fields: UsageFields = {};
	if (typeof usage.input_tokens === "number") fields.input = usage.input_tokens;
	if (typeof usage.output_tokens === "number") fields.output = usage.output_tokens;
	if (typeof usage.cache_read_input_tokens === "number") fields.cacheRead = usage.cache_read_input_tokens;
	if (typeof usage.cache_creation_input_tokens === "number") fields.cacheWrite = usage.cache_creation_input_tokens;
	const creation = usage.cache_creation;
	if (creation && typeof creation === "object") {
		const oneHour = (creation as Record<string, unknown>).ephemeral_1h_input_tokens;
		if (typeof oneHour === "number") fields.cacheWrite1h = oneHour;
	}
	return fields;
}

function stopReason(delta: unknown): string | undefined {
	if (!delta || typeof delta !== "object") return undefined;
	const reason = (delta as Record<string, unknown>).stop_reason;
	return typeof reason === "string" ? reason : undefined;
}

function errorMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const message = (error as Record<string, unknown>).message;
		if (typeof message === "string" && message) return message;
	}
	return "Anthropic stream error";
}

function numberField(value: unknown): number {
	return typeof value === "number" ? value : 0;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}
