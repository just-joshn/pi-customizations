import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;
type Selection = { model: NonNullable<ExtensionContext["model"]>; thinkingLevel: ThinkingLevel };
const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const code = "grok-4.7-xhigh-fast";
const judgment = "claude-opus-5-5-max";
const panel = [judgment, "gpt-5.6-sol-max", code];
const defaults = new Map<string, string[]>([
  ["feature, refactoring", [code]], ["bug-fix", [code]], ["perf-issue", [code]],
  ["hillclimb", [code]], ["judgment and prose", [judgment]], ["hardest tasks", [judgment]],
  ["how explorer", [code]], ["how explainer", [judgment]], ["why investigators", [code]],
  ["why synthesizer", [judgment]], ["reflect tooling", ["gpt-5.6-sol-max"]],
  ["reflect judgment, divergent, synthesizer", [judgment]], ["arena runners", panel],
  ["arena cross-judge pool", panel], ["swarm workers", [code]], ["architect runners", panel],
  ["interrogate reviewers", panel],
]);
const panelRoles = new Set(["arena runners", "arena cross-judge pool", "architect runners", "interrogate reviewers"]);
const budgets = new Map<string, ThinkingLevel | undefined>([
  ["unlimited — keep max", undefined], ["large — xhigh reasoning", "xhigh"],
  ["medium — high reasoning", "high"], ["small — medium reasoning", "medium"],
]);

export function modelConfigPath(): string {
  return join(getAgentDir(), "pstack", "models.mdc");
}

export async function readModelRule(): Promise<string> {
  try {
    return await readFile(modelConfigPath(), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

function isAlias(value: string): boolean {
  return value === "auto" || value === "inherit-parent";
}

export function resolveModel(request: string | undefined, ctx: ExtensionContext): Selection {
  if (request === undefined || isAlias(request)) {
    if (!ctx.model) throw new Error("No parent model is selected. Select a Pi model before running pstack.");
    return { model: ctx.model, thinkingLevel: ctx.thinkingLevel ?? "off" };
  }
  const available = ctx.modelRegistry.getAvailable();
  const choices = available.map((model) => `${model.provider}/${model.id}`).join(", ");
  const exact = available.filter((model) => `${model.provider}/${model.id}` === request || model.id === request);
  let matches = exact;
  let effort: ThinkingLevel | undefined;
  if (matches.length === 0) {
    const split = request.lastIndexOf(":");
    if (split >= 0) {
      const suffix = request.slice(split + 1);
      effort = levels.find((level) => level === suffix);
      if (!effort) throw new Error(`Unknown thinking level '${suffix}'. Use ${levels.join(", ")}.`);
      const name = request.slice(0, split);
      matches = available.filter((model) => `${model.provider}/${model.id}` === name || model.id === name);
    }
  }
  const model = matches.length === 1 ? matches[0] : undefined;
  if (!model) {
    throw new Error(`${matches.length > 1 ? "Ambiguous" : "Unavailable"} model '${request}'. Use an exact provider/id from: ${choices || "none (configure Pi provider credentials first)"}. Aliases: inherit-parent, auto. Run /setup-pstack to configure roles.`);
  }
  const supported = getSupportedThinkingLevels(model);
  if (effort && !supported.includes(effort)) {
    throw new Error(`Model '${model.provider}/${model.id}' does not support '${effort}'. Supported thinking levels: ${supported.join(", ")}.`);
  }
  const inherited = ctx.thinkingLevel ?? "off";
  return { model, thinkingLevel: effort ?? (supported.includes(inherited) ? inherited : supported[0] ?? "off") };
}

function applyBudget(value: string, target: ThinkingLevel | undefined, ctx: ExtensionContext): string {
  if (isAlias(value) || !target) return value;
  const exact = ctx.modelRegistry.getAvailable().some((model) => model.id === value || `${model.provider}/${model.id}` === value);
  const base = exact ? value : value.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
  const { model } = resolveModel(base, ctx);
  const supported = getSupportedThinkingLevels(model);
  const selected = levels.slice(0, levels.indexOf(target) + 1).reverse().find((level) => supported.includes(level));
  if (!selected) throw new Error(`No supported thinking level at or below ${target} for ${base}.`);
  return `${model.provider}/${model.id}:${selected}`;
}

type ModelTable = ReadonlyMap<string, string[]>;

function readTable(current: string): { working: ModelTable; dropped: string[] } {
  let working: ModelTable = new Map(defaults);
  const dropped: string[] = [];
  let frontmatter = false;
  for (const line of current.split(/\r?\n/)) {
    if (line.trim() === "---") { frontmatter = !frontmatter; continue; }
    if (frontmatter || line.startsWith("#") || !line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const role = line.slice(0, separator).trim();
    const values = line.slice(separator + 1).split(",").map((value) => value.trim());
    if (defaults.has(role)) working = new Map([...working, [role, values]]);
    else dropped.push(line);
  }
  return { working, dropped };
}

function validateRole(role: string, values: string[], target: ThinkingLevel | undefined, ctx: ExtensionContext): void {
  if (values.length === 0 || (!panelRoles.has(role) && values.length !== 1)) throw new Error(`${role} requires ${panelRoles.has(role) ? "at least one model" : "one model"}.`);
  for (const value of values) {
    if (!value) throw new Error("Empty model selection.");
    if (!isAlias(value)) {
      resolveModel(value, ctx);
      applyBudget(value, target, ctx);
    }
  }
}

function needsChoice(role: string, values: string[], target: ThinkingLevel | undefined, ctx: ExtensionContext): boolean {
  try { validateRole(role, values, target, ctx); return false; } catch { return true; }
}

async function editRole(role: string, previous: string[], target: ThinkingLevel | undefined, ctx: ExtensionContext): Promise<string[] | undefined> {
  const choices = [...ctx.modelRegistry.getAvailable().flatMap((model) => {
    const name = `${model.provider}/${model.id}`;
    return target ? [name] : [name, ...getSupportedThinkingLevels(model).map((level) => `${name}:${level}`)];
  }), "inherit-parent", "auto"];
  while (true) {
    const answer = panelRoles.has(role)
      ? await ctx.ui.input(`${role}: comma-separated models, ordered; duplicate aliases count. Available: ${choices.join(", ")}`, previous.join(", "))
      : await ctx.ui.select(`${role} (current: ${previous.join(", ")})`, choices);
    if (answer === undefined) return undefined;
    try {
      const values = (panelRoles.has(role) ? answer.split(",") : [answer]).map(value => applyBudget(value.trim(), target, ctx));
      validateRole(role, values, target, ctx);
      return values;
    } catch (error) { ctx.ui.notify(String(error), "error"); }
  }
}

async function writeConfiguration(working: ModelTable, budget: string, target: ThinkingLevel | undefined): Promise<void> {
  const name = budget.split(" — ")[0];
  const text = `---\ndescription: pstack per-role model choices (overrides skill defaults)\nalwaysApply: true\n---\n# pstack model configuration. Delete a role line to fall back to its skill default.\n# auto and inherit-parent use the parent model; repeated panel entries each spawn a worker.\n# budget: ${name} (${target ?? "max"})\n${[...working].map(([role, values]) => `${role}: ${values.join(", ")}`).join("\n")}\n`;
  const destination = modelConfigPath();
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}

export async function setupModels(ctx: ExtensionContext): Promise<boolean> {
  if (!ctx.hasUI) throw new Error("/setup-pstack requires Pi interactive or RPC dialog UI. Start interactive Pi and run /setup-pstack; no configuration was written.");
  const current = await readModelRule();
  const parsed = readTable(current);
  const oldBudget = current.match(/^# budget: (.+)$/m)?.[1];
  const budget = await ctx.ui.select(`pstack reasoning budget${oldBudget ? ` (current: ${oldBudget})` : ""}`, [...budgets.keys()]);
  if (budget === undefined) return false;
  if (!budgets.has(budget)) throw new Error(`Unknown budget '${budget}'.`);
  const target = budgets.get(budget);
  let working: ModelTable = new Map([...parsed.working].map(([role, values]) => [role, values.map((value) => {
    try { return applyBudget(value, target, ctx); } catch { return value; }
  })]));
  while (true) {
    const table = [...working].map(([role, values]) => `${role}: ${values.join(", ")}${needsChoice(role, values, target, ctx) ? " [needs a choice]" : ""}`).join("\n");
    ctx.ui.notify(`${table}${parsed.dropped.length ? `\nDropped retired roles:\n${parsed.dropped.join("\n")}` : ""}`, "info");
    const pending = [...working].find(([role, values]) => needsChoice(role, values, target, ctx));
    const action = pending?.[0] ?? await ctx.ui.select("Accept model table or change a role", ["Accept as-is", ...working.keys()]);
    if (action === undefined) return false;
    if (action !== "Accept as-is") {
      const previous = working.get(action);
      if (!previous) throw new Error(`Unknown role '${action}'.`);
      const values = await editRole(action, previous, target, ctx);
      if (!values) return false;
      working = new Map([...working, [action, values]]);
      continue;
    }
    if (!await ctx.ui.confirm("Write pstack model configuration?", `${budget}\n\n${table}\n\n${modelConfigPath()}`)) return false;
    for (const [role, values] of working) validateRole(role, values, target, ctx);
    await writeConfiguration(working, budget, target);
    ctx.ui.notify(`Wrote ${modelConfigPath()}. Applies from the next prompt; re-run /setup-pstack to update it.`, "info");
    return true;
  }
}
