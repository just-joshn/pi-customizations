import {
	calculateCost,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Model,
	type StopReason,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { fromClaudeCodeName } from "./identity.ts";
import { type UsageFields, type WireEvent } from "./sse.ts";

interface OpenTool {
	contentIndex: number;
	partialJson: string;
}

export interface Reducer {
	output: AssistantMessage;
	events: AssistantMessageEvent[];
	apply(event: WireEvent): void;
	finish(): void;
}

export function createReducer(
	model: Model,
	tools: readonly { name: string }[] | undefined,
	onEvent?: (event: AssistantMessageEvent) => void,
): Reducer {
	const output = emptyMessage(model);
	const events: AssistantMessageEvent[] = [];
	const contentByProviderIndex = new Map<number, number>();
	const toolsByProviderIndex = new Map<number, OpenTool>();
	let started = false;
	let stopReason: string | undefined;
	let closed = false;

	const push = (event: AssistantMessageEvent) => {
		events.push(event);
		onEvent?.(event);
	};

	const contentIndexFor = (providerIndex: number) => contentByProviderIndex.get(providerIndex) ?? providerIndex;

	const ensureStart = () => {
		if (started) return;
		started = true;
		output.stopReason = "pending";
		push({ type: "start", partial: output });
	};

	const applyUsage = (usage: UsageFields) => {
		if (usage.input !== undefined) output.usage.input = usage.input;
		if (usage.output !== undefined) output.usage.output = usage.output;
		if (usage.cacheRead !== undefined) output.usage.cacheRead = usage.cacheRead;
		if (usage.cacheWrite !== undefined) output.usage.cacheWrite = usage.cacheWrite;
		if (usage.cacheWrite1h !== undefined) output.usage.cacheWrite1h = usage.cacheWrite1h;
		output.usage.totalTokens =
			output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
		calculateCost(model, output.usage);
	};

	const fail = (message: string, aborted = false) => {
		if (closed) return;
		closed = true;
		output.stopReason = aborted ? "aborted" : "error";
		output.errorMessage = message;
		push({ type: "error", reason: output.stopReason, error: output });
	};

	const succeed = (reason: Extract<StopReason, "stop" | "length" | "toolUse">) => {
		if (closed) return;
		closed = true;
		output.stopReason = reason;
		push({ type: "done", reason, message: output });
	};

	return {
		output,
		events,
		apply(event) {
			if (closed) return;
			if (event.kind === "ping" || event.kind === "ignore") return;
			if (event.kind === "error") {
				ensureStart();
				fail(event.message);
				return;
			}
			if (event.kind === "message_start") {
				ensureStart();
				if (event.id) output.responseId = event.id;
				if (event.model) output.responseModel = event.model;
				applyUsage(event.usage);
				return;
			}
			if (event.kind === "block_start") {
				ensureStart();
				const contentIndex = output.content.length;
				if (event.block.type === "text") {
					output.content.push({ type: "text", text: event.block.text ?? "" });
					contentByProviderIndex.set(event.index, contentIndex);
					push({ type: "text_start", contentIndex, partial: output });
					if (event.block.text) push({ type: "text_delta", contentIndex, delta: event.block.text, partial: output });
					return;
				}
			if (event.block.type === "thinking" || event.block.type === "redacted_thinking") {
					output.content.push({
						type: "thinking",
						thinking: event.block.type === "thinking" ? event.block.thinking ?? "" : "",
						thinkingSignature: event.block.type === "redacted_thinking" ? event.block.data ?? "" : "",
						redacted: event.block.type === "redacted_thinking",
					});
					contentByProviderIndex.set(event.index, contentIndex);
					push({ type: "thinking_start", contentIndex, partial: output });
					return;
				}
				const name = fromClaudeCodeName(event.block.name ?? "", tools);
				const toolCall: ToolCall = {
					type: "toolCall",
					id: event.block.id ?? "",
					name,
					arguments: objectInput(event.block.input),
				};
				output.content.push(toolCall);
				contentByProviderIndex.set(event.index, contentIndex);
				toolsByProviderIndex.set(event.index, { contentIndex, partialJson: "" });
				push({ type: "toolcall_start", contentIndex, partial: output });
				return;
			}
			if (event.kind === "block_delta") {
				const contentIndex = contentIndexFor(event.index);
				const block = output.content[contentIndex];
				if (!block) return;
				if (event.delta.type === "text_delta" && block.type === "text") {
					block.text += event.delta.text;
					push({ type: "text_delta", contentIndex, delta: event.delta.text, partial: output });
					return;
				}
				if (event.delta.type === "thinking_delta" && block.type === "thinking") {
					block.thinking += event.delta.thinking;
					push({ type: "thinking_delta", contentIndex, delta: event.delta.thinking, partial: output });
					return;
				}
				if (event.delta.type === "signature_delta" && block.type === "thinking") {
					block.thinkingSignature = (block.thinkingSignature ?? "") + event.delta.signature;
					return;
				}
				if (event.delta.type === "input_json_delta" && block.type === "toolCall") {
					const open = toolsByProviderIndex.get(event.index);
					if (open) open.partialJson += event.delta.partial_json;
					block.arguments = parsePartial(open?.partialJson ?? event.delta.partial_json, block.arguments);
					push({ type: "toolcall_delta", contentIndex, delta: event.delta.partial_json, partial: output });
				}
				return;
			}
			if (event.kind === "block_stop") {
				const contentIndex = contentIndexFor(event.index);
				const block = output.content[contentIndex];
				if (!block) return;
				if (block.type === "text") {
					push({ type: "text_end", contentIndex, content: block.text, partial: output });
					return;
				}
				if (block.type === "thinking") {
					push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
					return;
				}
				const open = toolsByProviderIndex.get(event.index);
				block.arguments = parsePartial(open?.partialJson ?? "", block.arguments);
				toolsByProviderIndex.delete(event.index);
				push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
				return;
			}
			if (event.kind === "message_delta") {
				ensureStart();
				if (event.stopReason) stopReason = event.stopReason;
				applyUsage(event.usage);
				return;
			}
			if (stopReason) closeWithStop(stopReason, succeed, fail);
			else fail("Anthropic stream ended without a stop reason");
		},
		finish() {
			if (closed) return;
			if (!started) {
				fail("Anthropic stream ended without a start event");
				return;
			}
			if (stopReason) closeWithStop(stopReason, succeed, fail);
			else fail("Anthropic stream ended without a stop reason");
		},
	};
}

function closeWithStop(
	stopReason: string,
	succeed: (reason: Extract<StopReason, "stop" | "length" | "toolUse">) => void,
	fail: (message: string) => void,
) {
	if (stopReason === "end_turn" || stopReason === "pause_turn" || stopReason === "stop_sequence") {
		succeed("stop");
		return;
	}
	if (stopReason === "max_tokens") {
		succeed("length");
		return;
	}
	if (stopReason === "tool_use") {
		succeed("toolUse");
		return;
	}
	fail(`Unrecognized stop reason: ${stopReason}`);
}

function objectInput(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
	return {};
}

function parsePartial(partialJson: string, current: Record<string, unknown>): Record<string, unknown> {
	if (!partialJson) return current;
	try {
		const parsed = JSON.parse(partialJson) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {
		return current;
	}
	return current;
}

function emptyMessage(model: Model): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

export function abortedMessage(model: Model, message: string): AssistantMessage {
	return {
		...emptyMessage(model),
		stopReason: "aborted",
		errorMessage: message,
	};
}

export function errorMessage(model: Model, message: string): AssistantMessage {
	return {
		...emptyMessage(model),
		stopReason: "error",
		errorMessage: message,
	};
}
