/**
 * Scripted provider for the tmux smoke harness (scripts/tmux-smoke.mjs).
 *
 * Registers provider "smoke" with model "scripted", selectable as smoke/scripted,
 * whose stream never touches the network. The turn is a bash call followed by a
 * final message, which is enough to paint every message and tool surface the theme
 * colors, so the smoke can assert real escapes without credentials or a paid API.
 *
 * Registration and streaming shapes follow docs/custom-provider.md.
 */

import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SCRIPTED_PROVIDER = "smoke";
export const SCRIPTED_MODEL_ID = "scripted";
export const SCRIPTED_MODEL_NAME = "Scripted";
export const SMOKE_COMMAND = "echo theme-smoke";
export const FINAL_TEXT = "Theme smoke complete.";

type ScriptStep =
	| { readonly kind: "tool"; readonly call: ToolCall }
	| { readonly kind: "text"; readonly text: string };

const SCRIPT: readonly ScriptStep[] = [
	{
		kind: "tool",
		call: {
			type: "toolCall",
			id: "smoke-call-bash",
			name: "bash",
			arguments: { command: SMOKE_COMMAND },
		},
	},
	{ kind: "text", text: FINAL_TEXT },
];

const countToolResults = (messages: TranscriptContext["messages"]) =>
	messages.filter((message) => message.role === "toolResult").length;

const zeroedUsage = (): AssistantMessage["usage"] => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function streamScripted(
	model: Model<string>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const step =
		SCRIPT[Math.min(countToolResults(context.messages), SCRIPT.length - 1)];

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
			if (!step) throw new Error("scripted provider has no step for this turn");
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			await options?.onPayload?.(
				{ provider: "smoke-scripted", step: step.kind },
				model,
			);
			stream.push({ type: "start", partial: message });

			let stopReason: AssistantMessage["stopReason"];
			if (step.kind === "tool") {
				const call = { ...step.call, id: `${step.call.id}-${Date.now()}` };
				message.content.push({ ...call });
				stream.push({
					type: "toolcall_start",
					contentIndex: 0,
					partial: message,
				});
				stream.push({
					type: "toolcall_end",
					contentIndex: 0,
					toolCall: call,
					partial: message,
				});
				stopReason = "toolUse";
			} else {
				message.content.push({ type: "text", text: step.text });
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				stream.push({
					type: "text_delta",
					contentIndex: 0,
					delta: step.text,
					partial: message,
				});
				stream.push({
					type: "text_end",
					contentIndex: 0,
					content: step.text,
					partial: message,
				});
				stopReason = "stop";
			}

			await options?.onResponse?.(
				{ status: 200, headers: { "x-scripted-provider": "smoke" } },
				model,
			);
			message.stopReason = stopReason;
			stream.push({ type: "done", reason: stopReason, message });
			stream.end();
		} catch (error) {
			message.stopReason = options?.signal?.aborted ? "aborted" : "error";
			message.errorMessage =
				error instanceof Error ? error.message : String(error);
			stream.push({
				type: "error",
				reason: message.stopReason,
				error: message,
			});
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
