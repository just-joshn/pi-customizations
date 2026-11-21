import { posix } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { GUEST_WORKSPACE, toGuestPath } from './gondolin/paths.ts';

export const PLAN_ENTRY = 'pstack-plan';
const PLAN_COMMAND = 'plan';
const PLAN_SUBCOMMANDS = ['on', 'off', 'status'] as const;
const ALLOWED_ROOT_FILES = new Set(['TODO.md', '.pi/TODO.md']);
const PLANS_PREFIX = 'plans/';
const READONLY_SUBAGENT = 'scout';

export const PLAN_SECTION = [
  'Plan mode is active (/plan). Inspect code, run read-only checks, and write the plan to a Markdown file under plans/<slug>.md (you may also update TODO.md or .pi/TODO.md).',
  'Do not edit implementation files until the user explicitly approves execution or turns plan mode off with /plan off.',
].join(' ');

const planDataSchema = z.object({ active: z.boolean().optional() });
const pathInputSchema = z.object({ path: z.string() });
const subagentInputSchema = z.object({
  agent: z.string().optional(),
  stop: z.string().optional(),
  tasks: z.array(z.object({ agent: z.string() })).optional(),
  chain: z.array(z.object({ agent: z.string() })).optional(),
});

const recordedActive = (data: unknown): boolean => planDataSchema.safeParse(data).data?.active ?? false;

const branchPlanActive = (ctx: ExtensionContext): boolean => ctx.sessionManager.getBranch().reduce<boolean>((current, entry) => (entry.type === 'custom' && entry.customType === PLAN_ENTRY ? recordedActive(entry.data) : current), false);

const showPlan = (active: boolean, ctx: ExtensionContext): void => {
  if (ctx.hasUI) ctx.ui.setStatus(PLAN_ENTRY, active ? 'plan' : undefined);
};

/** Returns true when `targetPath` is inside `plans/` or is the working `TODO.md` / `.pi/TODO.md` checklist. */
export function isPlanWritablePath(targetPath: string, cwd: string): boolean {
  const rel = posix.relative(GUEST_WORKSPACE, toGuestPath(cwd, targetPath));
  if (rel.startsWith('..') || rel === '') return false;
  return ALLOWED_ROOT_FILES.has(rel) || rel.startsWith(PLANS_PREFIX);
}

function hasWriteCapableSubagent(input: unknown): boolean {
  const parsed = subagentInputSchema.safeParse(input);
  if (!parsed.success) return true;
  const agents = [...(parsed.data.agent ? [parsed.data.agent] : []), ...(parsed.data.tasks?.map((item) => item.agent) ?? []), ...(parsed.data.chain?.map((item) => item.agent) ?? [])];
  if (parsed.data.stop && agents.length === 0) return false;
  return agents.length === 0 || agents.some((agent) => agent !== READONLY_SUBAGENT);
}

const planCompletions = (prefix: string) => {
  const items = PLAN_SUBCOMMANDS.filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
  return items.length ? items : null;
};

/** Registers /plan, enforces read-only implementation boundaries while active, and returns a reader of plan state. */
export function registerPlan(pi: ExtensionAPI): () => boolean {
  let active = false;
  const setActive = (next: boolean, ctx: ExtensionContext): void => {
    active = next;
    pi.appendEntry(PLAN_ENTRY, { active });
    showPlan(active, ctx);
  };
  const restore = (ctx: ExtensionContext): void => {
    const next = branchPlanActive(ctx);
    const changed = next !== active;
    active = next;
    if (changed || active) showPlan(active, ctx);
  };

  pi.on('session_start', async (_event, ctx) => restore(ctx));
  pi.on('session_tree', async (_event, ctx) => restore(ctx));
  pi.on('tool_call', async (event, ctx) => {
    if (!active) return undefined;
    if (event.toolName === 'edit' || event.toolName === 'write') {
      const parsed = pathInputSchema.safeParse(event.input);
      if (parsed.success && isPlanWritablePath(parsed.data.path, ctx.cwd)) return undefined;
      return { block: true, reason: 'Plan mode is active. Write plans under plans/<slug>.md (or TODO.md / .pi/TODO.md), or run /plan off to edit code.' };
    }
    if (event.toolName === 'subagent' && hasWriteCapableSubagent(event.input)) {
      return { block: true, reason: 'Plan mode is active. Only read-only scout subagents may run until /plan off.' };
    }
    return undefined;
  });

  pi.registerCommand(PLAN_COMMAND, {
    description: 'Toggle read-only plan mode (/plan on|off|status|<goal>). Plans write under plans/<slug>.md.',
    getArgumentCompletions: planCompletions,
    handler: async (args, ctx) => {
      const trimmed = z.string().parse(args).trim();
      if (!trimmed || trimmed === 'status') {
        if (ctx.hasUI) ctx.ui.notify(active ? 'Plan mode is on. /plan off ends it.' : 'Plan mode is off. /plan on or /plan <goal> starts it.', 'info');
        return;
      }
      if (trimmed === 'off') {
        setActive(false, ctx);
        if (ctx.hasUI) ctx.ui.notify('Plan mode off.', 'info');
        return;
      }
      if (trimmed === 'on') {
        setActive(true, ctx);
        if (ctx.hasUI) ctx.ui.notify('Plan mode on. Edits are restricted to plans/<slug>.md.', 'info');
        return;
      }
      setActive(true, ctx);
      pi.sendUserMessage(trimmed);
    },
  });

  return () => active;
}
