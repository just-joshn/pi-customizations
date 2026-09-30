export const modelFamilies = ["sonnet", "opus", "haiku", "fable"] as const;

export type ModelChoice = Readonly<{ request: string | undefined; steppedFrom?: string; dropped?: string }>;

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

function newestInFamily(family: string, available: readonly string[]): string | undefined {
  return available
    .filter((id) => id.toLowerCase().includes(family))
    .toSorted()
    .at(-1);
}

function materialize(value: string | undefined, available: readonly string[]): ModelChoice {
  if (isInherit(value) || value === undefined) return { request: undefined };
  const lowered = value.toLowerCase();
  const family = modelFamilies.find((name) => name === lowered);
  if (family) {
    const found = newestInFamily(family, available);
    return found ? { request: found, steppedFrom: family } : { request: undefined, dropped: family };
  }
  return available.includes(value) ? { request: value } : { request: undefined, dropped: value };
}

export function chooseChildModel(input: ModelInputs): ModelChoice {
  if (input.fork) return { request: undefined };
  const forced = (input.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? input.env.PI_SUBAGENT_MODEL_FORCE)?.trim();
  if (forced) return materialize(forced, input.available);
  if (!isInherit(input.toolModel)) return materialize(input.toolModel, input.available);
  if (input.definitionModel !== undefined) return materialize(input.definitionModel, input.available);
  return materialize(envModel(input.env), input.available);
}
