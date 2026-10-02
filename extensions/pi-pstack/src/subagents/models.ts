import { envEnabled } from "./gates.ts";

export const modelFamilies = ["sonnet", "opus", "haiku", "fable"] as const;
const familyRank: Readonly<Record<string, number>> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 };

export type ModelChoice = Readonly<{ request: string | undefined; steppedFrom?: string; dropped?: string; ignoredOverride?: string }>;

type ModelInputs = Readonly<{
  toolModel?: string;
  definitionModel?: string;
  inheritCap?: string;
  parent?: string;
  fork: boolean;
  env: NodeJS.ProcessEnv;
  available: readonly string[];
}>;

type ModelId = Readonly<{ reference: string; provider: string; prefix: string; core: string; longContext: boolean }>;

function parseModelId(reference: string): ModelId {
  const slash = reference.indexOf("/");
  const provider = slash === -1 ? "" : reference.slice(0, slash);
  const id = reference.slice(slash + 1);
  const at = id.indexOf("claude-");
  const prefix = at > 0 ? id.slice(0, at) : "";
  const longContext = /\[1m\]$/i.test(id);
  return { reference, provider, prefix, core: id.slice(prefix.length).replace(/\[1m\]$/i, ""), longContext };
}

function envModel(env: NodeJS.ProcessEnv): string | undefined {
  const value = (env.CLAUDE_CODE_SUBAGENT_MODEL ?? env.PI_SUBAGENT_MODEL)?.trim();
  return value && value.toLowerCase() !== "inherit" ? value : undefined;
}

function isInherit(value: string | undefined): boolean {
  return value === undefined || value.trim().toLowerCase() === "inherit";
}

function modelFamily(value: string): string | undefined {
  const normalized = value.toLowerCase();
  return modelFamilies.find((family) => family === normalized) ?? normalized.match(/(?:^|[/.])claude-(sonnet|opus|haiku|fable)(?:-|\[|$)/)?.[1];
}

function preferred<T>(items: readonly T[], keep: (item: T) => boolean): readonly T[] {
  const kept = items.filter(keep);
  return kept.length > 0 ? kept : items;
}

function newestInFamily(family: string, available: readonly string[], parent: string | undefined): string | undefined {
  const members = available.filter((reference) => modelFamily(reference) === family).map(parseModelId);
  const origin = parent === undefined ? undefined : parseModelId(parent);
  const onProvider = origin ? preferred(members, (member) => member.provider === origin.provider) : members;
  const decorated = origin ? preferred(onProvider, (member) => member.prefix === origin.prefix) : onProvider;
  const wantsLong = family === "opus" && origin?.longContext === true;
  const context = preferred(decorated, (member) => member.longContext === wantsLong);
  return context.toSorted((left, right) => left.core.localeCompare(right.core, "en", { numeric: true })).at(-1)?.reference;
}

function materialize(value: string | undefined, input: ModelInputs): ModelChoice {
  if (isInherit(value) || value === undefined) return { request: undefined };
  if (input.available.includes(value)) return { request: value };
  const family = modelFamily(value);
  const found = family ? newestInFamily(family, input.available, input.parent) : undefined;
  return found ? { request: found, steppedFrom: value } : { request: undefined, dropped: value };
}

function capped(input: ModelInputs): ModelChoice {
  const cap = input.inheritCap;
  const parentFamily = input.parent === undefined ? undefined : modelFamily(input.parent);
  if (!cap || !parentFamily || (familyRank[parentFamily] ?? 0) <= (familyRank[cap] ?? Infinity)) return { request: undefined };
  return { request: newestInFamily(cap, input.available, input.parent) };
}

function forced(input: ModelInputs): ModelChoice {
  if (input.toolModel?.trim().toLowerCase() === "inherit") return { request: undefined };
  const overridden = input.toolModel ?? input.definitionModel;
  const ignoredOverride = overridden && !isInherit(overridden) ? { ignoredOverride: overridden } : {};
  const configured = envModel(input.env);
  if (configured === undefined && input.inheritCap) return capped(input);
  return { ...materialize(configured, input), ...ignoredOverride };
}

export function chooseChildModel(raw: ModelInputs): ModelChoice {
  if (raw.fork) return { request: undefined };
  const coordinatorInherits = envEnabled(raw.env.CLAUDE_CODE_COORDINATOR_MODE) && Boolean(raw.env.CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL);
  const { toolModel: _discarded, ...withoutTool } = raw;
  const input: ModelInputs = coordinatorInherits ? withoutTool : raw;
  if ((input.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? input.env.PI_SUBAGENT_MODEL_FORCE)?.trim()) return forced(input);
  if (input.toolModel === undefined && input.inheritCap) return capped(input);
  const requested = input.toolModel ?? input.definitionModel;
  if (requested !== undefined) {
    const choice = materialize(requested, input);
    if (!choice.dropped) return choice;
    return { ...materialize(envModel(input.env), input), dropped: choice.dropped };
  }
  return materialize(envModel(input.env), input);
}
