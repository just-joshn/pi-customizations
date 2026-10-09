import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { Container } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { isAlias, modelConfigPath, readModelRule, resolveModel, skillDefaultTable } from './models.ts';
import { setupWriteCard } from './tool-cards.ts';

type ThinkingLevel = NonNullable<ExtensionContext['thinkingLevel']>;

const budgets = new Map<string, ThinkingLevel>([
  ['unlimited — max reasoning', 'max'],
  ['large — xhigh reasoning', 'xhigh'],
  ['medium — high reasoning', 'high'],
  ['small — medium reasoning', 'medium'],
]);
const budgetValues = [...budgets.keys()] as [string, ...string[]];
const panelRoles = new Set(['arena runners', 'arena cross-judge pool', 'architect runners', 'interrogate reviewers']);

type ModelTable = ReadonlyMap<string, string[]>;

function readTable(current: string): { working: ModelTable; dropped: string[] } {
  const working = new Map([...skillDefaultTable].map(([role, values]) => [role, [...values]]));
  const dropped: string[] = [];
  let frontmatter = false;
  for (const line of current.split(/\r?\n/)) {
    if (line.trim() === '---') {
      frontmatter = !frontmatter;
      continue;
    }
    if (frontmatter || line.startsWith('#') || !line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const role = line.slice(0, separator).trim();
    const values = line
      .slice(separator + 1)
      .split(',')
      .map((value) => value.trim());
    if (skillDefaultTable.has(role)) working.set(role, values);
    else dropped.push(line);
  }
  return { working, dropped };
}

function validateRole(role: string, values: string[], ctx: ExtensionToolContext): void {
  if (values.length === 0 || (!panelRoles.has(role) && values.length !== 1)) throw new Error(`${role} requires ${panelRoles.has(role) ? 'at least one model' : 'one model'}.`);
  for (const value of values) {
    if (!value) throw new Error('Empty model selection.');
    if (!isAlias(value)) resolveModel(value, ctx);
  }
}

function ruleText(working: ModelTable, budget: string, target: ThinkingLevel): string {
  const name = budget.split(' — ')[0];
  return `---\ndescription: pstack per-role model choices (overrides skill defaults)\nalwaysApply: true\n---\n# pstack model configuration. One line per role. Delete a line to fall back to the skill default.\n# \`inherit-parent\` or \`auto\` as a value: the role runs on the parent chat model (omit Task \`model\`). Alias entries in a panel list still count toward its fan-out.\n# budget: ${name} (${target})\n${[...working].map(([role, values]) => `${role}: ${values.join(', ')}`).join('\n')}\n`;
}

function lineEditStats(before: string, after: string): { added: number; removed: number } {
  const count = (text: string) => {
    const bag = new Map<string, number>();
    for (const line of text.split(/\r?\n/)) bag.set(line, (bag.get(line) ?? 0) + 1);
    return bag;
  };
  const previous = count(before);
  const next = count(after);
  let removed = 0;
  let added = 0;
  for (const [line, total] of previous) {
    const keep = next.get(line) ?? 0;
    if (total > keep) removed += total - keep;
  }
  for (const [line, total] of next) {
    const keep = previous.get(line) ?? 0;
    if (total > keep) added += total - keep;
  }
  return { added, removed };
}

async function writeConfiguration(text: string): Promise<void> {
  const destination = modelConfigPath();
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function currentBudget(current: string): string | undefined {
  return current.match(/^# budget: (.+)$/m)?.[1];
}

const tableRecord = (working: ModelTable): Record<string, string> =>
  Object.fromEntries([...working].map(([role, values]) => [role, values.join(', ')]));

function roleConfirmPrompt(roles: Record<string, string>, dropped: readonly string[]): string {
  const lines = Object.entries(roles).map(([role, value]) => `${role}: ${value}`);
  const droppedBlock = dropped.length === 0 ? 'Dropped retired roles: none.' : `Dropped retired roles:\n${dropped.join('\n')}`;
  return [
    'Current roles (one line per role; do not summarize):',
    ...lines,
    droppedBlock,
    'Accept as-is, or change specific roles?',
  ].join('\n');
}

async function stateAction(ctx: ExtensionToolContext) {
  const current = await readModelRule();
  const { working, dropped } = readTable(current);
  const availableModels = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
  const roles = tableRecord(working);
  return {
    rulePath: modelConfigPath(),
    budget: currentBudget(current) ?? null,
    roles,
    dropped,
    availableModels,
    roleConfirmPrompt: roleConfirmPrompt(roles, dropped),
  };
}

async function writeAction(budget: string, roleOverrides: readonly { role: string; value: string }[] | undefined, ctx: ExtensionToolContext) {
  const target = budgets.get(budget);
  if (!target) throw new Error(`Unknown budget '${budget}'. Use one of: ${budgetValues.join(', ')}.`);
  const current = await readModelRule();
  const { working, dropped } = readTable(current);
  let next: ModelTable = working;
  for (const override of roleOverrides ?? []) {
    if (!next.has(override.role)) throw new Error(`Unknown role '${override.role}'. Run the state action for the role list.`);
    next = new Map([
      ...next,
      [override.role, override.value.split(',').map((value) => value.trim())],
    ]);
  }
  for (const [role, values] of next) validateRole(role, values, ctx);
  const text = ruleText(next, budget, target);
  const { added, removed } = lineEditStats(current, text);
  await writeConfiguration(text);
  return {
    written: true,
    rulePath: modelConfigPath(),
    budget: currentBudget(await readModelRule()) ?? null,
    added,
    removed,
    before: current,
    after: text,
    roles: tableRecord(next),
    dropped,
  };
}

export function registerSetupTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pstack_setup',
    label: 'Configure pstack models',
    description:
      'Read pstack model state or write the validated pstack model rule. Call with action "state" to load the current budget, role values, dropped retired lines, detected models, and roleConfirmPrompt. Paste roleConfirmPrompt as the AskQuestion prompt verbatim for role confirm (do not summarize). Then call with action "write" and the chosen budget (and any role overrides) to validate and write the rule atomically.',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('state'), Type.Literal('write')]),
      budget: Type.Optional(Type.String({ description: 'One of the exact budget labels from the state action' })),
      roleOverrides: Type.Optional(Type.Array(Type.Object({ role: Type.String(), value: Type.String({ description: 'Comma-separated model ids or aliases' }) }))),
    }),
    outputSchema: Type.Unknown(),
    exposure: 'model-only',
    executionMode: 'sequential',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    renderCall(_args, _theme, context) {
      const component = (context.lastComponent as Container | undefined) ?? new Container();
      component.clear();
      return component;
    },
    renderResult(result, _options, theme, context) {
      const component = (context.lastComponent as Container | undefined) ?? new Container();
      component.clear();
      if (context.args.action === 'write') {
        const details = result.details as { added: number; removed: number; before: string; after: string };
        return setupWriteCard(details, theme);
      }
      return component;
    },
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === 'state') {
        const state = await stateAction(ctx);
        return { content: [{ type: 'text', text: JSON.stringify(state) }], details: state, structuredContent: state };
      }
      const written = await writeAction(params.budget ?? '', params.roleOverrides, ctx);
      const summary = `Edited pstack-models.mdc +${written.added} -${written.removed}`;
      return { content: [{ type: 'text', text: summary }], details: written, structuredContent: written };
    },
  });
}