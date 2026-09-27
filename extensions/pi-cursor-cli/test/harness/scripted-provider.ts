/**
 * Scripted provider for the tmux smoke harness (scripts/tmux-smoke.mjs).
 * Registers provider "smoke" with model "scripted" (selectable as
 * smoke/scripted) whose stream never touches the network: each turn returns a
 * pre-canned assistant message keyed by how many tool results the transcript
 * already carries.
 *
 *   0 tool results -> bash tool call: echo parity-smoke
 *   1 tool result  -> todo_update tool call: one completed "Smoke passed"
 *   2 tool results -> final text: "Parity smoke complete."
 *
 * Registration and streaming shapes follow docs/custom-provider.md and the
 * checked custom-provider-anthropic example: legacy ProviderConfig form with a
 * streamSimple implementation, onPayload/onResponse honored per the stream
 * contract, usage zeroed, concrete terminal stop reasons.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

export const SCRIPTED_PROVIDER = "smoke";
export const SCRIPTED_MODEL_ID = "scripted";
export const SCRIPTED_MODEL_NAME = "Test Model";
export const FINAL_TEXT = "Parity smoke complete.";

interface ToolStep {
	readonly kind: "tool";
	readonly call: ToolCall;
}

interface TextStep {
	readonly kind: "text";
	readonly text: string;
}

type ScriptStep = ToolStep | TextStep;

const SCRIPT: readonly ScriptStep[] = [
	{
		kind: "tool",
		call: { type: "toolCall", id: "smoke-call-bash", name: "bash", arguments: { command: "echo parity-smoke" } },
	},
	{
		kind: "tool",
		call: {
			type: "toolCall",
			id: "smoke-call-todo",
			name: "todo_update",
			arguments: { todos: [{ id: "smoke-1", content: "Smoke passed", status: "completed" }] },
		},
	},
	{ kind: "text", text: FINAL_TEXT },
];

function countToolResults(messages: TranscriptContext["messages"]): number {
	return messages.filter((m) => m.role === "toolResult").length;
}

function zeroedUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function streamScripted(
	model: Model<string>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const step = SCRIPT[Math.min(countToolResults(context.messages), SCRIPT.length - 1)]!;

	(async () => {
		const message: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: zeroedUsage(),
			stopReason: "pending",
			timestamp: Date.now(),
		};
		try {
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			await options?.onPayload?.({ provider: "smoke-scripted", step: step.kind }, model);

			stream.push({ type: "start", partial: message });
			let stopReason: AssistantMessage["stopReason"];
			if (step.kind === "tool") {
				const call = { ...step.call, id: `${step.call.id}-${Date.now()}` };
				message.content.push({ ...call });
				stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
				stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
				stopReason = "toolUse";
			} else {
				message.content.push({ type: "text", text: step.text });
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				stream.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: message });
				stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: message });
				stopReason = "stop";
			}

			await options?.onResponse?.({ status: 200, headers: { "x-scripted-provider": "smoke" } }, model);
			message.stopReason = stopReason;
			stream.push({ type: "done", reason: stopReason, message });
			stream.end();
		} catch (error) {
			message.stopReason = options?.signal?.aborted ? "aborted" : "error";
			message.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: message.stopReason, error: message });
			stream.end();
		}
	})();

	return stream;
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(SCRIPTED_PROVIDER, {
		name: "Smoke Scripted",
		baseUrl: "http://127.0.0.1:9",
		apiKey: "smoke-not-a-real-key",
		api: "smoke-scripted",
		streamSimple: streamScripted,
		models: [
			{
				id: SCRIPTED_MODEL_ID,
				name: SCRIPTED_MODEL_NAME,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		],
	});
}
