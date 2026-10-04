import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, type ExtensionContext, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { createDelivery } from './deliver.ts';
import { boundedResult } from './results.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillPath = join(root, 'host/skills/goal/SKILL.md');
const Goal = Type.Object({ objective: Type.String({ minLength: 1 }), status: Type.String({ enum: ['active', 'complete', 'cleared'] }) });
type Goal = Static<typeof Goal>;

const usage = 'Usage: /goal <objective>. Use /goal clear to drop the active goal. A leading time limit is unsupported. Use /loop for recurring work.';
const timeLimit = /^\d+(?:\.\d+)?\s*(?:s|m|h|d|sec|secs|min|mins|hr|hrs|hour|hours)\b\s*/i;

export function parseGoalArgs(args: string): { objective: string; droppedTimeLimit: boolean } {
  const trimmed = args.trim();
  const stripped = trimmed.replace(timeLimit, '');
  return { objective: stripped, droppedTimeLimit: stripped !== trimmed };
}

export function continuationPrompt(objective: string): string {
  return `Goal still active. Objective:\n${objective}\n\nContinue working. Call GetGoal if you lost the objective. Audit every requirement against fresh evidence. Call UpdateGoal with status complete only when the audit passes.`;
}

function describe(goal: Goal | undefined): string {
  return goal ? `Goal (${goal.status}): ${goal.objective}` : 'No goal.';
}

type GoalStore = { read: () => Goal | undefined; restore: (ctx: ExtensionContext) => void; set: (next: Goal | undefined, ctx: ExtensionContext) => void };

function createGoalStore(pi: ExtensionAPI): GoalStore {
  let goal: Goal | undefined;
  const show = (ctx: ExtensionContext) => ctx.ui.setStatus('pstack-goal', goal?.status === 'active' ? 'goal' : undefined);
  return {
    read: () => goal,
    restore(ctx) {
      goal = undefined;
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === 'custom' && entry.customType === 'pstack-goal' && Check(Goal, entry.data)) goal = structuredClone(entry.data);
      }
      show(ctx);
    },
    set(next, ctx) {
      goal = next;
      if (next) pi.appendEntry('pstack-goal', structuredClone(next));
      show(ctx);
    },
  };
}

function registerGoalHooks(pi: ExtensionAPI, store: GoalStore): void {
  pi.on('session_start', (_event, ctx) => store.restore(ctx));
  pi.on('session_tree', (_event, ctx) => store.restore(ctx));
  pi.on('before_agent_start', (event) => {
    const goal = store.read();
    if (goal?.status === 'active') event.systemPromptOptions.sections.pstack_goal = `Active goal. Pursue it to completion and never shrink its scope.\n${goal.objective}`;
    else delete event.systemPromptOptions.sections.pstack_goal;
  });
  pi.on('agent_before_settle', (event) => {
    const goal = store.read();
    if (goal?.status !== 'active' || event.outcome !== 'completed') return;
    return {
      entries: [{ type: 'custom_message', customType: 'pstack-goal-continue', display: true, content: continuationPrompt(goal.objective) }],
      continue: true,
    };
  });
}

function registerGoalCommand(pi: ExtensionAPI, store: GoalStore): void {
  const deliver = createDelivery(pi);
  pi.registerCommand('goal', {
    description: 'Set a goal that Pi pursues to completion across turns.',
    handler: async (args, ctx) => {
      const goal = store.read();
      if (args.trim().toLowerCase() === 'clear') {
        if (goal) store.set({ ...goal, status: 'cleared' }, ctx);
        ctx.ui.notify('Goal cleared.', 'info');
        return;
      }
      const { objective, droppedTimeLimit } = parseGoalArgs(args);
      if (!objective) {
        ctx.ui.notify(`${usage}\n${describe(goal)}`, 'info');
        return;
      }
      if (droppedTimeLimit) ctx.ui.notify('Time limits are unsupported. The goal is created without one.', 'warning');
      const skill = parseFrontmatter<Record<string, unknown>>(await readFile(skillPath, 'utf8')).body;
      await deliver(ctx, `<skill name="goal" location="${skillPath}">\nReferences are relative to ${dirname(skillPath)}.\n\n${skill}\n</skill>\n\n${objective}`);
    },
  });
}

function registerGoalTools(pi: ExtensionAPI, store: GoalStore): void {
  pi.registerTool({
    executionMode: 'sequential',
    name: 'CreateGoal',
    namespace: goalNamespace,
    label: 'Create goal',
    description: 'Arm a goal that continues across turns until UpdateGoal marks it complete. Call exactly once per goal. Fails while another goal is active.',
    promptSnippet: 'Arm a goal that Pi pursues across turns until complete',
    parameters: Type.Object({ objective: Type.String({ minLength: 1, description: 'Full objective with every deliverable' }) }),
    outputSchema: Goal,
    exposure: 'direct',
    annotations: { openWorldHint: false, destructiveHint: false },
    async execute(_id, params, _signal, _update, ctx) {
      const current = store.read();
      if (current?.status === 'active') throw new Error(`A goal is already active. ${describe(current)}`);
      const next = { objective: params.objective, status: 'active' };
      store.set(next, ctx);
      return boundedResult(describe(next), next, ctx);
    },
  });
  pi.registerTool({
    executionMode: 'sequential',
    name: 'UpdateGoal',
    namespace: goalNamespace,
    label: 'Update goal',
    description: 'Mark the active goal complete after a requirement-by-requirement audit against fresh evidence. Never call it to pause or give up.',
    promptSnippet: 'Mark the active goal complete after a passing completion audit',
    parameters: Type.Object({ status: Type.String({ enum: ['complete'] }) }),
    outputSchema: Goal,
    exposure: 'direct',
    annotations: { idempotentHint: true, openWorldHint: false, destructiveHint: false },
    async execute(_id, _params, _signal, _update, ctx) {
      const current = store.read();
      if (current?.status !== 'active') throw new Error('No active goal to complete.');
      const next = { ...current, status: 'complete' };
      store.set(next, ctx);
      return boundedResult(describe(next), next, ctx);
    },
  });
}

function registerGetGoal(pi: ExtensionAPI, store: GoalStore): void {
  pi.registerTool({
    executionMode: 'parallel',
    name: 'GetGoal',
    namespace: goalNamespace,
    label: 'Get goal',
    description: 'Read back the current goal objective and status. Use at each tick and after context compaction.',
    promptSnippet: 'Read back the current goal objective and status',
    parameters: Type.Object({}),
    outputSchema: Type.Union([Goal, Type.Null()]),
    exposure: 'direct',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    async execute(_id, _params, _signal, _update, ctx) {
      const current = store.read();
      return boundedResult(describe(current), current ?? null, ctx);
    },
  });
}

const goalNamespace = {
  name: 'pstack_goals',
  description: 'Branch-aware persistent goal lifecycle.',
  instructions: 'Arm one objective with CreateGoal. Read it with GetGoal after context loss. Complete it with UpdateGoal only after auditing every requirement against fresh evidence.',
} as const;

export function registerGoal(pi: ExtensionAPI): void {
  const store = createGoalStore(pi);
  registerGoalHooks(pi, store);
  registerGoalCommand(pi, store);
  registerGoalTools(pi, store);
  registerGetGoal(pi, store);
}
