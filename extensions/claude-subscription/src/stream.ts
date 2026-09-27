import {
	collapseSystemMessages,
	createAssistantMessageEventStream,
	getCurrentTools,
	type AssistantMessageEventStream,
	type Model,
	type ProviderResponse,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { DEFAULT_PROVIDER_VERSION } from "./identity.ts";
import { buildMessagesRequest, hasAuthorization } from "./request.ts";
import { createReducer, errorMessage } from "./reduce.ts";
import { takeSseEvents } from "./sse.ts";

const DEFAULT_TIMEOUT_MS = 600_000;

export function streamSubscription(
	model: Model,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const token = options?.apiKey ?? "";
	if (!token) {
		throw new Error("Could not resolve authentication method. Run /login claude-subscription.");
	}
	const stream = createAssistantMessageEventStream();
	void runStream(stream, model, context, options, token);
	return stream;
}

async function runStream(
	stream: AssistantMessageEventStream,
	model: Model,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
	token: string,
): Promise<void> {
	const transcript = collapseSystemMessages(context);
	const tools = getCurrentTools(transcript.messages);
	let started = false;
	const reducer = createReducer(model, tools, (event) => {
		started = true;
		stream.push(event);
	});
	try {
		const built = buildMessagesRequest({
			model,
			context,
			token,
			providerVersion: versionFrom(options),
			maxTokens: options?.maxTokens,
			reasoning: options?.reasoning,
			thinkingBudgets: options?.thinkingBudgets,
			headers: options?.headers,
			toolChoice: options?.toolChoice,
			metadataUserId: metadataUserId(options?.metadata),
		});
		if (!hasAuthorization(built.headers)) {
			throw new Error("Could not resolve authentication method. Authorization was removed.");
		}
		let payload: unknown = built.body;
		const replacement = await options?.onPayload?.(payload, model);
		if (replacement !== undefined) payload = replacement;
		const response = await fetchMessages(built.url, built.headers, payload, options);
		const providerResponse = toProviderResponse(response);
		await options?.onResponse?.(providerResponse, model);
		if (!response.ok) {
			const message = await errorText(response);
			emitSetupError(stream, model, message);
			return;
		}
		if ((response.headers.get("content-type") ?? "").includes("application/json")) {
			emitSetupError(stream, model, await errorText(response));
			return;
		}
		await readSse(response, reducer, options?.signal);
		stream.end(reducer.output);
	} catch (error) {
		const aborted = options?.signal?.aborted === true;
		const message = aborted ? "Request was aborted" : errorTextFrom(error);
		if (!started) {
			emitSetupError(stream, model, message, aborted);
			return;
		}
		const failed = aborted
			? { ...reducer.output, stopReason: "aborted" as const, errorMessage: message }
			: { ...reducer.output, stopReason: "error" as const, errorMessage: message };
		stream.push({ type: "error", reason: failed.stopReason, error: failed });
		stream.end(failed);
	}
}

async function readSse(
	response: Response,
	reducer: ReturnType<typeof createReducer>,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (!response.body) throw new Error("Anthropic response had no body");
	const decoder = new TextDecoder();
	const reader = response.body.getReader();
	let rest = "";
	while (true) {
		if (signal?.aborted) throw new Error("Request was aborted");
		const chunk = await reader.read();
		if (chunk.done) break;
		rest += decoder.decode(chunk.value, { stream: true });
		const parsed = takeSseEvents(rest);
		rest = parsed.rest;
		for (const event of parsed.events) reducer.apply(event);
	}
	rest += decoder.decode();
	if (rest.trim()) {
		const parsed = takeSseEvents(`${rest}\n\n`);
		for (const event of parsed.events) reducer.apply(event);
	}
	reducer.finish();
}

async function fetchMessages(
	url: string,
	headers: Record<string, string>,
	payload: unknown,
	options: SimpleStreamOptions | undefined,
): Promise<Response> {
	const fetchImpl = options?.fetch ?? globalThis.fetch;
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const signals = [AbortSignal.timeout(timeoutMs)];
	if (options?.signal) signals.push(options.signal);
	return fetchImpl(url, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
		signal: AbortSignal.any(signals),
	});
}

function toProviderResponse(response: Response): ProviderResponse {
	const headers: Record<string, string> = {};
	response.headers.forEach((value, name) => {
		headers[name] = value;
	});
	return { status: response.status, headers };
}

async function errorText(response: Response): Promise<string> {
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed && typeof parsed === "object") {
			const body = parsed as Record<string, unknown>;
			const error = body.error;
			if (error && typeof error === "object") {
				const message = (error as Record<string, unknown>).message;
				if (typeof message === "string" && message) return message;
			}
			if (typeof body.message === "string" && body.message) return body.message;
		}
	} catch {
		return text || `Anthropic request failed with status ${response.status}`;
	}
	return text || `Anthropic request failed with status ${response.status}`;
}

function emitSetupError(
	stream: AssistantMessageEventStream,
	model: Model,
	message: string,
	aborted = false,
): void {
	const error = aborted
		? { ...errorMessage(model, message), stopReason: "aborted" as const }
		: errorMessage(model, message);
	stream.push({ type: "error", reason: error.stopReason, error });
	stream.end(error);
}

function versionFrom(options: SimpleStreamOptions | undefined): string {
	const fromEnv = options?.env?.CLAUDE_CODE_VERSION;
	if (typeof fromEnv === "string" && fromEnv) return fromEnv;
	return process.env.CLAUDE_CODE_VERSION || DEFAULT_PROVIDER_VERSION;
}

function metadataUserId(metadata: SimpleStreamOptions["metadata"]): string | undefined {
	const userId = metadata?.user_id;
	return typeof userId === "string" ? userId : undefined;
}

function errorTextFrom(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return "Anthropic request failed";
}
