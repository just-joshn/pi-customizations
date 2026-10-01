export const modelFamilies = ["sonnet", "opus", "haiku", "fable"] as const;

export type ModelChoice = Readonly<{ request: string | undefined; steppedFrom?: string; dropped?: string; ignoredOverride?: string }>;

type ModelInputs = Readonly<{
  toolModel?: string;
  definitionModel?: string;
  fork: boolean;
  env: NodeJS.ProcessEnv;
  available: readonly string[];
}>;

function envModel(env: NodeJS.ProcessEnv): string | undefined {
  const value = (env.CLAUDE_CODE_SUBAGENT_MODEL ?? env.PI_SUBAGENT_MODEL)?.trim();
  return value && value.toLowerCase() !== "inherit" ? value : undefined;
}

function isInherit(value: string | undefined): boolean {
  return value === undefined || value.trim().toLowerCase() === "inherit";
}

function modelFamily(value: string): string | undefined {
  const normalized = value.toLowerCase();
  return modelFamilies.find((family) => family === normalized) ?? normalized.match(/(?:^|\/)claude-(sonnet|opus|haiku|fable)(?:-|$)/)?.[1];
}

function newestInFamily(family: string, available: readonly string[]): string | undefined {
  return available
    .filter((id) => modelFamily(id) === family)
    .toSorted((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .at(-1);
}

function materialize(value: string | undefined, available: readonly string[]): ModelChoice {
  if (isInherit(value) || value === undefined) return { request: undefined };
  if (available.includes(value)) return { request: value };
  const family = modelFamily(value);
  if (family) {
    const found = newestInFamily(family, available);
    return found ? { request: found, steppedFrom: value } : { request: undefined, dropped: value };
  }
  return { request: undefined, dropped: value };
}

export function chooseChildModel(input: ModelInputs): ModelChoice {
  if (input.fork) return { request: undefined };
  const forced = (input.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? input.env.PI_SUBAGENT_MODEL_FORCE)?.trim();
  if (forced) {
    if (input.toolModel?.trim().toLowerCase() === "inherit") return { request: undefined };
    const ignoredOverride = input.toolModel ?? input.definitionModel;
    return { ...materialize(envModel(input.env), input.available), ...(ignoredOverride ? { ignoredOverride } : {}) };
  }
  const requested = input.toolModel ?? input.definitionModel;
  if (requested !== undefined) {
    const choice = materialize(requested, input.available);
    if (!choice.dropped) return choice;
    return { ...materialize(envModel(input.env), input.available), dropped: choice.dropped };
  }
  return materialize(envModel(input.env), input.available);
}
