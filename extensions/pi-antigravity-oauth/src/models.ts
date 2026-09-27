import type { Api, Model, RefreshModelsContext, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { parseCredential } from "./oauth.ts";
import { PROVIDER_ID, postCloudCode } from "./cloudcode.ts";

export const API: Api = "cloud-code-assist";

export type Family = "gemini" | "claude" | "gpt-oss";

interface FamilySpec {
	toolParameters: boolean;
	thinking: "level" | "budget" | "none";
	extraHeaders?: Record<string, string>;
	contextWindow: number;
	maxTokens: number;
}

export const FAMILY: Record<Family, FamilySpec> = {
	gemini: { toolParameters: false, thinking: "level", contextWindow: 1048576, maxTokens: 65535 },
	claude: {
		toolParameters: true,
		thinking: "budget",
		extraHeaders: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	"gpt-oss": { toolParameters: false, thinking: "none", contextWindow: 131072, maxTokens: 32768 },
};

export function familyOf(modelId: string): Family {
	if (modelId.startsWith("claude-")) return "claude";
	if (modelId.startsWith("gpt-oss-")) return "gpt-oss";
	return "gemini";
}

// Gemini Pro accepts only LOW and HIGH thinking levels.
const GEMINI_PRO_LEVELS: ThinkingLevelMap = { minimal: "low", low: "low", medium: "high", high: "high" };

function geminiLevels(modelId: string): ThinkingLevelMap | undefined {
	return /-pro\b/.test(modelId) ? GEMINI_PRO_LEVELS : undefined;
}

type ModelRow = Omit<Model<Api>, "api" | "provider" | "baseUrl">;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const BASELINE: readonly ModelRow[] = [
	{
		id: "gemini-3.1-pro-low",
		name: "Gemini 3.1 Pro Low (Antigravity)",
		reasoning: true,
		thinkingLevelMap: GEMINI_PRO_LEVELS,
		input: ["text", "image"],
		cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.375 },
		contextWindow: 1048576,
		maxTokens: 65535,
	},
	{
		id: "gemini-3-flash-agent",
		name: "Gemini 3 Flash Agent (Antigravity)",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.5, output: 3, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: 65535,
	},
	{
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6 (Antigravity)",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "claude-opus-4-6-thinking",
		name: "Claude Opus 4.6 Thinking (Antigravity)",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "gpt-oss-120b-medium",
		name: "GPT-OSS 120B Medium (Antigravity)",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.09, output: 0.36, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 32768,
	},
];

function toModel(row: ModelRow, baseUrl: string): Model<Api> {
	return { ...row, api: API, provider: PROVIDER_ID, baseUrl };
}

export function baselineModels(baseUrl: string): Model<Api>[] {
	return BASELINE.map((row) => toModel(row, baseUrl));
}

export interface AvailableModel {
	id: string;
	displayName?: string;
	supportsThinking?: boolean;
	supportsImages?: boolean;
	remainingFraction?: number;
	resetTime?: string;
}

const RUNTIME_ID = /^(gemini-|claude-|gpt-oss-)[\w.-]+$/;

export function parseAvailableModels(data: unknown): AvailableModel[] {
	const models = (data as { models?: unknown } | null)?.models;
	if (!models || typeof models !== "object") return [];
	const parsed: AvailableModel[] = [];
	for (const [id, raw] of Object.entries(models as Record<string, unknown>)) {
		if (!RUNTIME_ID.test(id) || !raw || typeof raw !== "object") continue;
		const info = raw as Record<string, unknown>;
		if (info.isInternal === true) continue;
		const quota = (info.quotaInfo ?? {}) as Record<string, unknown>;
		parsed.push({
			id,
			displayName: typeof info.displayName === "string" ? info.displayName : undefined,
			supportsThinking: typeof info.supportsThinking === "boolean" ? info.supportsThinking : undefined,
			supportsImages: typeof info.supportsImages === "boolean" ? info.supportsImages : undefined,
			remainingFraction: typeof quota.remainingFraction === "number" ? quota.remainingFraction : undefined,
			resetTime: typeof quota.resetTime === "string" ? quota.resetTime : undefined,
		});
	}
	return parsed.sort((a, b) => a.id.localeCompare(b.id));
}

export function catalogFromAvailable(available: readonly AvailableModel[], baseUrl: string): Model<Api>[] {
	return available.map((entry) => {
		const known = BASELINE.find((row) => row.id === entry.id);
		if (known) return toModel(known, baseUrl);
		const family = FAMILY[familyOf(entry.id)];
		const reasoning = entry.supportsThinking ?? family.thinking !== "none";
		return toModel(
			{
				id: entry.id,
				name: `${entry.displayName ?? entry.id} (Antigravity)`,
				reasoning,
				...(reasoning && familyOf(entry.id) === "gemini" && { thinkingLevelMap: geminiLevels(entry.id) }),
				input: entry.supportsImages === false ? ["text"] : ["text", "image"],
				cost: ZERO_COST,
				contextWindow: family.contextWindow,
				maxTokens: family.maxTokens,
			},
			baseUrl,
		);
	});
}

export function createFetchModels(endpoints: readonly string[]) {
	return async (context: RefreshModelsContext): Promise<Model<Api>[]> => {
		if (context.credential?.type !== "oauth") throw new Error("Google Antigravity is not logged in");
		const credential = parseCredential(context.credential);
		const data = await postCloudCode(
			endpoints,
			"fetchAvailableModels",
			credential.access,
			{ project: credential.projectId },
			context.signal,
		);
		return catalogFromAvailable(parseAvailableModels(data), endpoints[0]!);
	};
}
