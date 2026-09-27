import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "@earendil-works/pi-ai";

export function loadModels(): Model<"claude-subscription-messages">[] {
	const path = join(dirname(fileURLToPath(import.meta.url)), "catalog.json");
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!Array.isArray(parsed)) throw new Error("Claude subscription catalog is not a list");
	return parsed.map(parseModel);
}

function parseModel(value: unknown): Model<"claude-subscription-messages"> {
	if (!value || typeof value !== "object") throw new Error("Claude subscription catalog entry is not an object");
	const model = value as Record<string, unknown>;
	if (typeof model.id !== "string" || typeof model.name !== "string") {
		throw new Error("Claude subscription catalog entry is missing id or name");
	}
	if (typeof model.contextWindow !== "number" || typeof model.maxTokens !== "number") {
		throw new Error(`Claude subscription catalog entry ${model.id} is missing limits`);
	}
	return model as Model<"claude-subscription-messages">;
}
