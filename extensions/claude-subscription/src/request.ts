import {
	collapseSystemMessages,
	getCurrentSystemPrompt,
	getCurrentTools,
	type ImageContent,
	type Model,
	type ProviderHeaders,
	type TextContent,
	type ThinkingBudgets,
	type ThinkingLevel,
	type Tool,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	ANTHROPIC_VERSION,
	CLAUDE_CODE_BETA,
	CLAUDE_CODE_BILLING,
	PROVIDER_PREAMBLE,
	FINE_GRAINED_TOOL_STREAMING_BETA,
	INTERLEAVED_THINKING_BETA,
	OAUTH_BETA,
	providerUserAgent,
	toProviderName,
} from "./identity.ts";

const THINKING_BUDGETS = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
} as const;

const MIN_ANSWER_TOKENS = 1024;

export interface MessagesRequest {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

export interface BuildMessagesRequestInput {
	model: Model;
	context: TranscriptContext;
	token: string;
	providerVersion: string;
	maxTokens?: number;
	reasoning?: ThinkingLevel;
	thinkingBudgets?: ThinkingBudgets;
	headers?: ProviderHeaders;
	toolChoice?: "auto" | "none";
	metadataUserId?: string;
}

export function messagesUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
	return `${trimmed}/v1/messages`;
}

export function mergeHeaders(
	base: Record<string, string>,
	overrides: ProviderHeaders | undefined,
): Record<string, string> {
	const merged = new Map<string, string>();
	const canonical = new Map<string, string>();
	const set = (name: string, value: string | null) => {
		const lower = name.toLowerCase();
		const previous = canonical.get(lower);
		if (previous) merged.delete(previous);
		if (value === null) {
			canonical.delete(lower);
			return;
		}
		canonical.set(lower, name);
		merged.set(name, value);
	};
	for (const [name, value] of Object.entries(base)) set(name, value);
	for (const [name, value] of Object.entries(overrides ?? {})) set(name, value);
	return Object.fromEntries(merged);
}

export function hasAuthorization(headers: Record<string, string>): boolean {
	return Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
}

export function sanitizeText(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

export function buildMessagesRequest(input: BuildMessagesRequestInput): MessagesRequest {
	const transcript = collapseSystemMessages(input.context);
	const systemPrompt = getCurrentSystemPrompt(transcript.messages);
	const tools = getCurrentTools(transcript.messages);
	const thinking = thinkingFields(input.model, input.reasoning, input.thinkingBudgets, input.maxTokens);
	const betas = betaHeader(tools.length > 0, thinking.mode);
	const headers = mergeHeaders(
		{
			accept: "application/json",
			"content-type": "application/json",
			"anthropic-version": ANTHROPIC_VERSION,
			"anthropic-beta": betas,
			"anthropic-dangerous-direct-browser-access": "true",
			"user-agent": providerUserAgent(input.providerVersion),
			"x-app": "cli",
			authorization: `Bearer ${input.token}`,
		},
		input.headers,
	);
	const body: Record<string, unknown> = {
		model: input.model.id,
		max_tokens: thinking.maxTokens,
		stream: true,
		system: systemBlocks(systemPrompt),
		messages: convertMessages(transcript.messages, tools),
	};
	if (tools.length > 0) body.tools = convertTools(tools);
	if (thinking.thinking) body.thinking = thinking.thinking;
	if (thinking.outputConfig) body.output_config = thinking.outputConfig;
	if (input.toolChoice) body.tool_choice = { type: input.toolChoice };
	if (input.metadataUserId) body.metadata = { user_id: input.metadataUserId };
	return {
		url: messagesUrl(input.model.baseUrl),
		headers,
		body,
	};
}

function betaHeader(hasTools: boolean, mode: ThinkingMode): string {
	const features = [CLAUDE_CODE_BETA, OAUTH_BETA];
	if (hasTools) features.push(FINE_GRAINED_TOOL_STREAMING_BETA);
	if (mode === "budget") features.push(INTERLEAVED_THINKING_BETA);
	return features.join(",");
}

type ThinkingMode = "off" | "budget" | "adaptive";

function thinkingFields(
	model: Model,
	reasoning: ThinkingLevel | undefined,
	customBudgets: ThinkingBudgets | undefined,
	requestedMaxTokens: number | undefined,
): {
	mode: ThinkingMode;
	maxTokens: number;
	thinking?: Record<string, unknown>;
	outputConfig?: Record<string, unknown>;
} {
	const modelMax = model.maxTokens;
	if (!model.reasoning || !reasoning) {
		return { mode: "off", maxTokens: requestedMaxTokens ?? modelMax };
	}
	if (model.compat?.forceAdaptiveThinking === true || model.compat?.supportsMidConvoEffort === true) {
		return {
			mode: "adaptive",
			maxTokens: requestedMaxTokens ?? modelMax,
			thinking: { type: "adaptive", display: "summarized" },
			outputConfig: { effort: effortFor(model, reasoning) },
		};
	}
	const budget = thinkingBudget(reasoning, customBudgets);
	let maxTokens = requestedMaxTokens === undefined ? modelMax : Math.min(requestedMaxTokens + budget, modelMax);
	let tokens = budget;
	if (maxTokens <= tokens) tokens = Math.min(tokens, Math.max(0, maxTokens - MIN_ANSWER_TOKENS));
	if (tokens < 1024) {
		tokens = 1024;
		maxTokens = Math.min(modelMax, Math.max(maxTokens, tokens + MIN_ANSWER_TOKENS));
	}
	return {
		mode: "budget",
		maxTokens,
		thinking: { type: "enabled", budget_tokens: tokens, display: "summarized" },
	};
}

function effortFor(model: Model, level: ThinkingLevel): string {
	const mapped = model.thinkingLevelMap?.[level];
	if (typeof mapped === "string") return mapped;
	if (level === "minimal" || level === "low") return "low";
	if (level === "medium") return "medium";
	return "high";
}

function thinkingBudget(level: ThinkingLevel, custom: ThinkingBudgets | undefined): number {
	const clamped = level === "xhigh" || level === "max" ? "high" : level;
	const budgets = { ...THINKING_BUDGETS, ...custom };
	return budgets[clamped] ?? THINKING_BUDGETS.high;
}

function systemBlocks(systemPrompt: string): Array<Record<string, unknown>> {
	const blocks = [{ type: "text", text: CLAUDE_CODE_BILLING }, cachedText(PROVIDER_PREAMBLE)];
	if (systemPrompt.trim()) blocks.push(cachedText(sanitizeText(systemPrompt)));
	return blocks;
}

function cachedText(text: string): Record<string, unknown> {
	return { type: "text", text, cache_control: { type: "ephemeral" } };
}

function convertMessages(messages: TranscriptContext["messages"], tools: Tool[]): Array<Record<string, unknown>> {
	const params: Array<Record<string, unknown>> = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (!message || message.role === "system") continue;
		if (message.role === "user") {
			const content = userContent(message.content);
			if (content) params.push({ role: "user", content });
			continue;
		}
		if (message.role === "assistant") {
			const blocks = assistantBlocks(message.content);
			if (blocks.length > 0) params.push({ role: "assistant", content: blocks });
			continue;
		}
		const results = [toolResult(message)];
		let j = i + 1;
		while (j < messages.length && messages[j]?.role === "toolResult") {
			const next = messages[j];
			if (next?.role === "toolResult") results.push(toolResult(next));
			j++;
		}
		i = j - 1;
		params.push({ role: "user", content: results });
	}
	return applyCacheBreakpoint(params);
}

function userContent(content: string | Array<TextContent | ImageContent>): string | Array<Record<string, unknown>> | undefined {
	if (typeof content === "string") {
		const text = sanitizeText(content);
		return text.trim() ? text : undefined;
	}
	const blocks = contentBlocks(content);
	return blocks.length > 0 ? blocks : undefined;
}

function contentBlocks(content: Array<TextContent | ImageContent>): Array<Record<string, unknown>> {
	const blocks = content.map((block) => {
		if (block.type === "text") return { type: "text", text: sanitizeText(block.text) };
		return {
			type: "image",
			source: { type: "base64", media_type: block.mimeType, data: block.data },
		};
	});
	if (blocks.length > 0 && !blocks.some((block) => block.type === "text")) {
		blocks.unshift({ type: "text", text: "(see attached image)" });
	}
	return blocks;
}

function assistantBlocks(content: Array<TextContent | { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }>): Array<Record<string, unknown>> {
	const blocks: Array<Record<string, unknown>> = [];
	for (const block of content) {
		if (block.type === "text") {
			if (block.text.trim()) blocks.push({ type: "text", text: sanitizeText(block.text) });
			continue;
		}
		if (block.type === "thinking") {
			if (block.redacted && block.thinkingSignature) {
				blocks.push({ type: "redacted_thinking", data: block.thinkingSignature });
				continue;
			}
			if (block.thinkingSignature && block.thinking.trim()) {
				blocks.push({
					type: "thinking",
					thinking: sanitizeText(block.thinking),
					signature: block.thinkingSignature,
				});
				continue;
			}
			if (block.thinking.trim()) blocks.push({ type: "text", text: sanitizeText(block.thinking) });
			continue;
		}
		blocks.push({
			type: "tool_use",
			id: normalizeToolCallId(block.id),
			name: toProviderName(block.name),
			input: block.arguments,
		});
	}
	return blocks;
}

function toolResult(
	message: { toolCallId: string; content: Array<TextContent | ImageContent>; isError: boolean },
): Record<string, unknown> {
	return {
		type: "tool_result",
		tool_use_id: normalizeToolCallId(message.toolCallId),
		content: contentBlocks(message.content),
		is_error: message.isError,
	};
}

function applyCacheBreakpoint(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	if (messages.length === 0) return messages;
	const last = messages[messages.length - 1];
	if (!last || last.role !== "user") return messages;
	const content = last.content;
	if (typeof content === "string") {
		return [
			...messages.slice(0, -1),
			{ role: "user", content: [cachedText(content)] },
		];
	}
	if (!Array.isArray(content) || content.length === 0) return messages;
	const blocks = content.map((block, index) => {
		if (index !== content.length - 1 || !block || typeof block !== "object") return block;
		return { ...block, cache_control: { type: "ephemeral" } };
	});
	return [...messages.slice(0, -1), { ...last, content: blocks }];
}

function convertTools(tools: Tool[]): Array<Record<string, unknown>> {
	return tools.map((tool) => ({
		name: toProviderName(tool.name),
		description: tool.description,
		input_schema: inputSchema(tool.parameters),
	}));
}

function inputSchema(parameters: unknown): Record<string, unknown> {
	if (!parameters || typeof parameters !== "object") return { type: "object", properties: {} };
	const schema = parameters as Record<string, unknown>;
	if (schema.type === "object") return schema;
	return {
		type: "object",
		properties: schema.properties ?? {},
		required: schema.required ?? [],
	};
}

function normalizeToolCallId(id: string): string {
	const normalized = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
	return normalized || "tool";
}
