import { existsSync, readFileSync } from 'node:fs';

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ThemeColor } from '@earendil-works/pi-coding-agent';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { skillBlock } from './skill-block.ts';

export const MODE_ENTRY = 'pstack/mode';
const STATUS_KEY = 'pstack-mode';

/** The mode on the branch. `path` is the loaded skill's file; absent when no loaded skill has the name. */
export interface ActiveMode {
  skill: string;
  path?: string;
}

/**
 * Cursor's custom-mode lifecycle: a mode is `entered` until a request carries it, then `active`. Leaving or switching
 * away from an `active` mode leaves it `exited` until the next request says so once.
 */
export interface ModeState {
  active?: ActiveMode & { lifecycle: 'entered' | 'active' };
  exited?: string;
}

const left = (state: ModeState): string | undefined => (state.active?.lifecycle === 'active' ? state.active.skill : state.exited);

export function enterMode(state: ModeState, mode: ActiveMode): ModeState {
  const exited = left(state);
  return { active: { ...mode, lifecycle: 'entered' }, ...(exited === undefined ? {} : { exited }) };
}

export function exitMode(state: ModeState): ModeState {
  const exited = left(state);
  return exited === undefined ? {} : { exited };
}

/** What a request leaves behind: the mode it carried is now active, and its exit notice has been sent. */
export function afterRequest(state: ModeState): ModeState {
  return state.active === undefined ? {} : { active: { ...state.active, lifecycle: 'active' } };
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

/** A stored mode as a skill name only: a session file can come from elsewhere, so a stored path is ignored and a value that is not a plausible skill name (it would reach the system prompt) counts as no mode. */
function storedSkill(data: unknown): string | undefined {
  const skill = (data as { skill?: unknown } | null)?.skill;
  return typeof skill === 'string' && SKILL_NAME.test(skill) ? skill : undefined;
}

/**
 * Replays the branch into the mode state: each mode entry enters or leaves a mode, and an assistant message after it
 * shows a request carried the mode. Skills are resolved by name, never by a stored path.
 */
export function modeFromBranch(entries: readonly BranchEntry[], resolve: (skill: string) => ActiveMode = (skill) => ({ skill })): ModeState {
  let state: ModeState = {};
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === MODE_ENTRY) {
      const skill = storedSkill(entry.data);
      state = skill === undefined ? exitMode(state) : enterMode(state, resolve(skill));
    } else if (entry.type === 'message' && (entry as { message?: { role?: string } }).message?.role === 'assistant') state = afterRequest(state);
  }
  return state;
}

/** Cursor's custom-mode notices for the next request (CLI `custom-modes` module). */
export function modeNotice(state: ModeState): string | undefined {
  const lines: string[] = [];
  const { active, exited } = state;
  if (exited !== undefined && exited !== active?.skill) lines.push(`The user has exited ${exited} custom mode. Stop following that mode's skill. Continue without those constraints.`);
  if (active?.path === undefined && active !== undefined) lines.push(`Mode ${active.skill} is on, but no loaded skill has that name. Tell the user to run /mode off or /mode <skill>.`);
  else if (active?.path !== undefined && !existsSync(active.path)) lines.push(`Mode ${active.skill} is on, but its skill file ${active.path} no longer exists. Tell the user to run /mode off or /mode <skill>.`);
  else if (active?.lifecycle === 'entered')
    lines.push(`The user has entered ${active.skill} custom mode. Follow the skill instructions in ${JSON.stringify(active.path)} until the user exits or switches modes. Do not drift back to default agent behavior.`);
  else if (active !== undefined)
    lines.push(
      `Reminder: you are still in ${active.skill} mode. Follow that mode's skill on this turn. Do not drop it because the request looks small or you already have context. Do not drift back to default agent behavior. If you cannot state the mode's hard rules, read ${JSON.stringify(active.path)} before acting.`,
    );
  return lines.length === 0 ? undefined : lines.join('\n\n');
}

/**
 * The skill a mode keeps in context on every request until the user leaves it, in the block Pi's own /skill:name
 * expansion builds. Cursor keeps the attached skill durable in the conversation; a section keeps it in every request,
 * through compaction and restarts, and Pi re-sends a section only when it changes.
 */
export function modeSkill(mode: ActiveMode): string | undefined {
  // The frontmatter stays out of the model's context in a mode (MODE-004).
  return mode.path === undefined ? undefined : skillBlock(mode.skill, mode.path);
}

// A mode's badge shows the skill's `icon` (default: lightning) and `color`. Icon names map to terminal glyphs and
// color names to the nearest theme color.
const BADGE_ICONS: Record<string, string> = {
  crown: '♛',
  lightning: '⚡',
  code: '</>',
  terminal: '>_',
  bug: '✱',
  'git-branch': '⎇',
  'book-open': '❐',
  beaker: '⚗',
  shield: '⛨',
  rocket: '➶',
};
const BADGE_COLORS: Record<string, ThemeColor> = { green: 'success', red: 'error', yellow: 'warning', orange: 'warning', cyan: 'accent', blue: 'accent', purple: 'accent', magenta: 'accent', brand: 'accent' };

/** A skill carries `icon` and `color` under `metadata`, or at the top level of its frontmatter. */
function skillMetadata(mode: ActiveMode): Record<string, unknown> {
  if (mode.path === undefined || !existsSync(mode.path)) return {};
  const { frontmatter } = parseFrontmatter(readFileSync(mode.path, 'utf8'));
  const metadata = typeof frontmatter['metadata'] === 'object' && frontmatter['metadata'] !== null ? (frontmatter['metadata'] as Record<string, unknown>) : {};
  return { icon: frontmatter['icon'], color: frontmatter['color'], ...metadata };
}

export function modeBadge(mode: ActiveMode, metadata: Record<string, unknown> = skillMetadata(mode)): { text: string; color?: ThemeColor } {
  const iconName = String(metadata['icon']);
  const colorName = String(metadata['color']);
  const icon = Object.hasOwn(BADGE_ICONS, iconName) ? BADGE_ICONS[iconName] : BADGE_ICONS['lightning'];
  const color = Object.hasOwn(BADGE_COLORS, colorName) ? BADGE_COLORS[colorName] : undefined;
  return { text: `${icon} mode: ${mode.skill}`, ...(color === undefined ? {} : { color }) };
}

function loadedSkills(pi: ExtensionAPI): Map<string, string> {
  const skills = new Map<string, string>();
  for (const command of pi.getCommands()) {
    if (command.source === 'skill' && command.name.startsWith('skill:')) skills.set(command.name.slice('skill:'.length), command.sourceInfo.path);
  }
  return skills;
}

/** The mode sections of one request: Cursor's notice, and the skill the mode keeps in context. */
export interface ModeSections {
  pstack_mode?: string;
  pstack_mode_skill?: string;
}

export function registerMode(pi: ExtensionAPI): { sections: () => ModeSections } {
  let state: ModeState = {};
  const show = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const badge = state.active === undefined ? undefined : modeBadge(state.active);
    ctx.ui.setStatus(STATUS_KEY, badge === undefined ? undefined : badge.color === undefined ? badge.text : ctx.ui.theme.fg(badge.color, badge.text));
  };
  // The skill is looked up by name among loaded skills; a stored path is never read, since it can be stale or crafted.
  const restore = (ctx: ExtensionContext) => {
    state = modeFromBranch(ctx.sessionManager.getBranch(), (skill) => tryResolve(skill) ?? { skill });
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
    const { active } = state;
    if (command.kind === 'status') return ctx.ui.notify(active === undefined ? 'No mode is on.' : `Mode on: ${active.skill} (${active.path ?? 'no loaded skill has that name'}).`, 'info');
    state = command.kind === 'off' ? exitMode(state) : enterMode(state, resolveSkill(command.skill));
    pi.appendEntry(MODE_ENTRY, state.active === undefined ? null : { skill: state.active.skill });
    show(ctx);
    ctx.ui.notify(state.active === undefined ? 'Mode off.' : `Mode on: ${state.active.skill}. /mode off exits.`, 'info');
    if (command.kind === 'set' && command.task !== '') pi.sendUserMessage(command.task, { expandPromptTemplates: true, ...(ctx.isIdle() ? {} : { deliverAs: 'followUp' as const }) });
    return undefined;
  };

  pi.registerCommand('mode', {
    description: 'Keep a skill on every turn: /mode <skill> [task], /mode off, /mode',
    getArgumentCompletions: (prefix) => ['off', ...[...loadedSkills(pi).keys()].toSorted()].filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name })),
    handler: async (args, ctx) => {
      try {
        handle(args, ctx);
      } catch (error) {
        ctx.ui.notify((error as Error).message, 'error');
      }
    },
  });

  return {
    sections: () => {
      const notice = modeNotice(state);
      const skill = state.active === undefined ? undefined : modeSkill(state.active);
      state = afterRequest(state);
      return { ...(notice === undefined ? {} : { pstack_mode: notice }), ...(skill === undefined ? {} : { pstack_mode_skill: skill }) };
    },
  };
}
