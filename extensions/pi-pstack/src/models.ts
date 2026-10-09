import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type ThinkingLevel = NonNullable<ExtensionContext['thinkingLevel']>;
type Selection = { model: NonNullable<ExtensionContext['model']>; thinkingLevel: ThinkingLevel };
const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const code = 'grok-4.7-xhigh-fast';
const judgment = 'claude-opus-5-5-xhigh';
const panel: readonly string[] = [judgment, code];
export const skillDefaultTable: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['feature, refactoring', [code]],
  ['bug-fix', [code]],
  ['perf-issue', [code]],
  ['hillclimb', [code]],
  ['judgment and prose', [judgment]],
  ['hardest tasks', [judgment]],
  ['how explorer', [code]],
  ['how explainer', [judgment]],
  ['why investigators', [code]],
  ['why synthesizer', [judgment]],
  ['reflect tooling', [code]],
  ['reflect judgment, divergent, synthesizer', [judgment]],
  ['arena runners', panel],
  ['arena cross-judge pool', panel],
  ['swarm workers', [code]],
  ['architect runners', panel],
  ['interrogate reviewers', panel],
]);
export const roleNames: readonly string[] = [...skillDefaultTable.keys()];

export function modelConfigPath(): string {
  return join(getAgentDir(), 'pstack', 'models.mdc');
}

export function projectModelConfigPath(cwd: string): string {
  return join(cwd, '.pi', 'pstack', 'models.mdc');
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}

function roleLines(text: string): Map<string, string> {
  const lines = new Map<string, string>();
  let frontmatter = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '---') frontmatter = !frontmatter;
    else if (!frontmatter && !line.startsWith('#') && line.includes(':')) lines.set(line.slice(0, line.indexOf(':')).trim(), line);
  }
  return lines;
}

export async function readModelRule(cwd?: string): Promise<string> {
  const user = await readOptional(modelConfigPath());
  const project = cwd ? roleLines(await readOptional(projectModelConfigPath(cwd))) : new Map<string, string>();
  if (project.size === 0) return user;
  const kept = user.split(/\r?\n/).filter((line) => !project.has(line.slice(0, Math.max(line.indexOf(':'), 0)).trim()) || line.startsWith('#'));
  return `${kept.join('\n').trimEnd()}\n${[...project.values()].join('\n')}\n`;
}

export function isAlias(value: string): boolean {
  return value === 'auto' || value === 'inherit-parent';
}

export function resolveModel(request: string | undefined, ctx: ExtensionContext): Selection {
  if (request === undefined || isAlias(request)) {
    if (!ctx.model) throw new Error('No parent model is selected. Select a Pi model before running pstack.');
    return { model: ctx.model, thinkingLevel: ctx.thinkingLevel ?? 'off' };
  }
  const available = ctx.modelRegistry.getAvailable();
  const choices = available.map((model) => `${model.provider}/${model.id}`).join(', ');
  const exact = available.filter((model) => `${model.provider}/${model.id}` === request || model.id === request);
  let matches = exact;
  let effort: ThinkingLevel | undefined;
  if (matches.length === 0) {
    const split = request.lastIndexOf(':');
    if (split >= 0) {
      const suffix = request.slice(split + 1);
      effort = levels.find((level) => level === suffix);
      if (!effort) throw new Error(`Unknown thinking level '${suffix}'. Use ${levels.join(', ')}.`);
      const name = request.slice(0, split);
      matches = available.filter((model) => `${model.provider}/${model.id}` === name || model.id === name);
    }
  }
  const model = matches.length === 1 ? matches[0] : undefined;
  if (!model) {
    throw new Error(
      `${matches.length > 1 ? 'Ambiguous' : 'Unavailable'} model '${request}'. Use an exact provider/id from: ${choices || 'none (configure Pi provider credentials first)'}. Aliases: inherit-parent, auto. Run /setup-pstack to configure roles.`,
    );
  }
  const supported = getSupportedThinkingLevels(model);
  if (effort && !supported.includes(effort)) {
    throw new Error(`Model '${model.provider}/${model.id}' does not support '${effort}'. Supported thinking levels: ${supported.join(', ')}.`);
  }
  const inherited = ctx.thinkingLevel ?? 'off';
  return { model, thinkingLevel: effort ?? clampThinkingLevel(model, inherited) };
}

export function applyBudget(value: string, target: ThinkingLevel | undefined, ctx: ExtensionContext): string {
  if (isAlias(value) || !target || !value) return value;
  const exact = ctx.modelRegistry.getAvailable().some((model) => model.id === value || `${model.provider}/${model.id}` === value);
  const base = exact ? value : value.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, '');
  const { model } = resolveModel(base, ctx);
  const supported = getSupportedThinkingLevels(model);
  const selected = levels
    .slice(0, levels.indexOf(target) + 1)
    .reverse()
    .find((level) => supported.includes(level));
  if (!selected) throw new Error(`No supported thinking level at or below ${target} for ${base}.`);
  return `${model.provider}/${model.id}:${selected}`;
}