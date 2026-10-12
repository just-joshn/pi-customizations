import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

export const MODE_ENTRY = 'pstack-two/mode';
const STATUS_KEY = 'pstack-two-mode';

/** The mode on the branch. `path` is the loaded skill's file; absent when no loaded skill has the name. */
export interface ActiveMode {
  skill: string;
  path?: string;
}

export type ModeCommand = { kind: 'status' } | { kind: 'off' } | { kind: 'set'; skill: string; task: string };

export function parseModeArgs(args: string): ModeCommand {
  const trimmed = args.trim();
  if (trimmed === '') return { kind: 'status' };
  if (trimmed === 'off') return { kind: 'off' };
  const match = /^\/?(\S+)(?:\s([\s\S]*))?$/.exec(trimmed);
  return { kind: 'set', skill: match?.[1] ?? trimmed, task: (match?.[2] ?? '').trim() };
}

interface BranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/**
 * The last mode entry on the branch, as a skill name only: a session file can come from elsewhere, so a stored path
 * is ignored and a value that is not a plausible skill name (it would reach the system prompt) counts as no mode.
 */
export function modeFromBranch(entries: readonly BranchEntry[]): ActiveMode | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== MODE_ENTRY) continue;
    const skill = (entry.data as { skill?: unknown } | null)?.skill;
    return typeof skill === 'string' && SKILL_NAME.test(skill) ? { skill } : undefined;
  }
  return undefined;
}

/**
 * The mode text for every request: the reminder first, then the skill block in the same shape as Pi's own
 * `/skill:name` expansion (agent-session.js `_expandSkillCommand`), which Pi does not export as a function.
 */
export function modeSection(mode: ActiveMode): string {
  if (mode.path === undefined) return `Custom Mode ${mode.skill} is on, but no loaded skill has that name. Tell the user to run /mode off or /mode <skill>.`;
  if (!existsSync(mode.path)) return `Custom Mode ${mode.skill} is on, but its skill file ${mode.path} no longer exists. Tell the user to run /mode off or /mode <skill>.`;
  const { frontmatter, body } = parseFrontmatter(readFileSync(mode.path, 'utf8'));
  const reminder = (frontmatter['metadata'] as Record<string, unknown> | undefined)?.['cursor-reminder'];
  return [
    `Custom Mode ${mode.skill} is on for every turn until the user runs /mode off.`,
    ...(typeof reminder === 'string' ? [reminder] : []),
    `<skill name="${mode.skill}" location="${mode.path}">`,
    `References are relative to ${dirname(mode.path)}.`,
    '',
    body.trim(),
    '</skill>',
  ].join('\n');
}

function loadedSkills(pi: ExtensionAPI): Map<string, string> {
  const skills = new Map<string, string>();
  for (const command of pi.getCommands()) {
    if (command.source === 'skill' && command.name.startsWith('skill:')) skills.set(command.name.slice('skill:'.length), command.sourceInfo.path);
  }
  return skills;
}

export function registerMode(pi: ExtensionAPI): { section: () => string | undefined } {
  let active: ActiveMode | undefined;
  const show = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, active === undefined ? undefined : `mode: ${active.skill}`);
  };
  // The skill is looked up by name among loaded skills; a stored path is never read, since it can be stale or crafted.
  const restore = (ctx: ExtensionContext) => {
    const stored = modeFromBranch(ctx.sessionManager.getBranch());
    active = stored === undefined ? undefined : (tryResolve(stored.skill) ?? { skill: stored.skill });
    show(ctx);
  };
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));

  const resolveSkill = (name: string): ActiveMode => {
    const skills = loadedSkills(pi);
    const path = skills.get(name);
    if (path === undefined) throw new Error(`No skill named "${name}". Skills that can back a mode: ${[...skills.keys()].toSorted().join(', ')}.`);
    return { skill: name, path };
  };

  function tryResolve(name: string): ActiveMode | undefined {
    try {
      return resolveSkill(name);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('No skill named')) return undefined;
      throw error;
    }
  }

  const handle = (args: string, ctx: ExtensionCommandContext) => {
    const command = parseModeArgs(args);
    if (command.kind === 'status') return ctx.ui.notify(active === undefined ? 'No Custom Mode is on.' : `Custom Mode: ${active.skill} (${active.path ?? 'no loaded skill has that name'})`, 'info');
    active = command.kind === 'off' ? undefined : resolveSkill(command.skill);
    pi.appendEntry(MODE_ENTRY, active === undefined ? null : { skill: active.skill });
    show(ctx);
    ctx.ui.notify(active === undefined ? 'Custom Mode off.' : `Custom Mode on: ${active.skill}. /mode off exits.`, 'info');
    if (command.kind === 'set' && command.task !== '') pi.sendUserMessage(command.task, { expandPromptTemplates: true, ...(ctx.isIdle() ? {} : { deliverAs: 'followUp' as const }) });
    return undefined;
  };

  pi.registerCommand('mode', {
    description: "Keep a skill on every turn (Cursor's Custom Mode): /mode <skill> [task], /mode off, /mode",
    getArgumentCompletions: (prefix) => ['off', ...[...loadedSkills(pi).keys()].toSorted()].filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name })),
    handler: async (args, ctx) => {
      try {
        handle(args, ctx);
      } catch (error) {
        ctx.ui.notify((error as Error).message, 'error');
      }
    },
  });

  return { section: () => (active === undefined ? undefined : modeSection(active)) };
}
