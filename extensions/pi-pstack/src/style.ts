// The persistent pstack style (spec 8.3): `/pstack on` keeps the poteto-mode skill in the parent's context until
// `/pstack off`. The selection lives in the session as custom entries, so resume, fork, and reload restore it.
import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { skillBlock } from './skill-block.ts';

export const STYLE_ENTRY = 'pstack/style';
export const STYLE_MESSAGE = 'pstack-style';
export const STYLE_SKILL = 'poteto-mode';

export type StyleMessageKind = 'skill' | 'off';

type Entry = Pick<SessionEntry, 'type'> & { customType?: string; data?: unknown; details?: unknown };

/** The last `/pstack on` or `/pstack off` on the active branch. */
export function styleOn(branch: readonly Entry[]): boolean {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as Entry;
    if (entry.type === 'custom' && entry.customType === STYLE_ENTRY) return (entry.data as { on?: unknown } | undefined)?.on === true;
  }
  return false;
}

/** The style message the model can still see: the latest one in the compacted context. */
function inContext(context: readonly Entry[]): StyleMessageKind | undefined {
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const entry = context[index] as Entry;
    if (entry.type !== 'custom_message' || entry.customType !== STYLE_MESSAGE) continue;
    const kind = (entry.details as { kind?: unknown } | undefined)?.kind;
    if (kind === 'skill' || kind === 'off') return kind;
  }
  return undefined;
}

/**
 * What a user-started run adds. The skill goes in once while the model cannot see it, so a later task or a compaction
 * that kept it adds nothing, and a compaction that summarized it away brings it back once. Turning the style off while
 * the skill is still visible adds one notice to stop following it.
 */
export function styleMessageKind(on: boolean, context: readonly Entry[]): StyleMessageKind | undefined {
  const seen = inContext(context);
  if (on) return seen === 'skill' ? undefined : 'skill';
  return seen === 'skill' ? 'off' : undefined;
}

/** The loaded poteto-mode skill file, as Pi discovered it. */
export function styleSkillPath(pi: ExtensionAPI): string | undefined {
  return pi.getCommands().find((command) => command.source === 'skill' && command.name === `skill:${STYLE_SKILL}`)?.sourceInfo.path;
}

const OFF_NOTICE = `The user turned the pstack style off with /pstack off. Stop following the ${STYLE_SKILL} skill unless the user invokes it again.`;

export function registerStyle(pi: ExtensionAPI): void {
  const show = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus('pstack-style', styleOn(ctx.sessionManager.getBranch()) ? 'pstack on' : undefined);
  };
  pi.on('session_start', (_event, ctx) => show(ctx));
  pi.on('session_tree', (_event, ctx) => show(ctx));
  pi.on('before_agent_start', (event, ctx) => {
    if (event.messageType !== 'user') return undefined;
    const kind = styleMessageKind(styleOn(ctx.sessionManager.getBranch()), ctx.sessionManager.buildContextEntries());
    if (kind === undefined) return undefined;
    if (kind === 'off') return { message: { customType: STYLE_MESSAGE, content: OFF_NOTICE, display: false, details: { kind } } };
    const path = styleSkillPath(pi);
    const block = path === undefined ? undefined : skillBlock(STYLE_SKILL, path);
    if (block === undefined) return undefined;
    return { message: { customType: STYLE_MESSAGE, content: block, display: false, details: { kind } } };
  });
}

/** Records the selection on the branch; the next user task picks it up. */
export function setStyle(pi: ExtensionAPI, ctx: ExtensionContext, on: boolean): void {
  pi.appendEntry(STYLE_ENTRY, { on });
  if (ctx.hasUI) ctx.ui.setStatus('pstack-style', on ? 'pstack on' : undefined);
}
