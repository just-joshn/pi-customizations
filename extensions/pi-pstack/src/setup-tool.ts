import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { isAlias, modelConfigPath, readModelRule, resolveModel, skillDefaultTable } from './models.ts';

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

async function writeConfiguration(working: ModelTable, budget: string, target: ThinkingLevel): Promise<void> {
  const name = budget.split(' — ')[0];
  const text = `---\ndescription: pstack per-role model choices (overrides skill defaults)\nalwaysApply: true\n---\n# pstack model configuration. One line per role. Delete a line to fall back to the skill default.\n# \`inherit-parent\` or \`auto\` as a value: the role runs on the parent chat model (omit Task \`model\`). Alias entries in a panel list still count toward its fan-out.\n# budget: ${name} (${target})\n${[...working].map(([role, values]) => `${role}: ${values.join(', ')}`).join('\n')}\n`;
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

async function stateAction(ctx: ExtensionToolContext) {
  const current = await readModelRule();
  const { working, dropped } = readTable(current);
  const availableModels = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
  return { rulePath: modelConfigPath(), budget: currentBudget(current) ?? null, roles: tableRecord(working), dropped, availableModels };
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
  await writeConfiguration(next, budget, target);
  return { written: true, rulePath: modelConfigPath(), budget: currentBudget(await readModelRule()) ?? null, roles: tableRecord(next), dropped };
}

export function registerSetupTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pstack_setup',
    label: 'Configure pstack models',
    description:
      'Read pstack model state or write the validated pstack model rule. Call with action "state" to load the current budget, role values, dropped retired lines and detected models. Ask the user the budget and role questions with AskQuestion, then call with action "write" and the chosen budget (and any role overrides) to validate and write the rule atomically.',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('state'), Type.Literal('write')]),
      budget: Type.Optional(Type.String({ description: 'One of the exact budget labels from the state action' })),
      roleOverrides: Type.Optional(Type.Array(Type.Object({ role: Type.String(), value: Type.String({ description: 'Comma-separated model ids or aliases' }) }))),
    }),
    outputSchema: Type.Unknown(),
    exposure: 'model-only',
    executionMode: 'sequential',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === 'state') {
        const state = await stateAction(ctx);
        return { content: [{ type: 'text', text: JSON.stringify(state) }], details: state, structuredContent: state };
      }
      const written = await writeAction(params.budget ?? '', params.roleOverrides, ctx);
      const summary = `Wrote ${written.rulePath} with budget ${written.budget}.`;
      return { content: [{ type: 'text', text: summary }], details: written, structuredContent: written };
    },
  });
}