import { fileURLToPath } from 'node:url';
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getDefaultMode } from './config.ts';
import { badgeFor, isProseMode, type Mode } from './modes.ts';
import { parseModeChange } from './parse.ts';
import { reinforcement, rulesetSection } from './ruleset.ts';
import { activeMode, applyPrompt, initialState, MODE_ENTRY, type ModeState, OFF, sameState, stateFromEntries } from './state.ts';

const STATUS_KEY = 'caveman';
const ONE_SHOT_SKILL = /^\/(?:caveman:)?(caveman-(?:commit|review|compress))(?=\s|$)/i;

export type PromptNote = { readonly kind: 'status'; readonly report: string } | { readonly kind: 'notice'; readonly text: string } | null;

export interface ModeController {
  readonly active: () => Mode | null;
  readonly handlePrompt: (text: string, ctx: ExtensionContext) => PromptNote;
}

interface PendingTurn {
  readonly context: string;
  readonly reinforce: boolean;
}

function pendingFor(note: PromptNote): PendingTurn | null {
  if (note?.kind === 'status') return { context: `Report this status verbatim without changing mode: ${note.report}`, reinforce: false };
  return note ? { context: note.text, reinforce: true } : null;
}

// A runtime copy loaded by `caveman wrap pi` or `caveman enable pi` can run first and replace the
// whole prompt, which drops sections, so the ruleset then rides the replacement.
function placeRuleset(section: string, options: BeforeAgentStartEvent['systemPromptOptions']): string | undefined {
  options.sections['caveman'] = section;
  const forced = options.forceSystemPrompt;
  return forced !== undefined && !forced.includes(section) ? `${forced}\n\n${section}` : undefined;
}

export function registerModeTracking(pi: ExtensionAPI): ModeController {
  let state: ModeState = OFF;
  let pending: PendingTurn | null = null;

  const render = (ctx: ExtensionContext): void => {
    const mode = activeMode(state);
    ctx.ui.setStatus(STATUS_KEY, mode ? ctx.ui.theme.fg('warning', badgeFor(mode)) : undefined);
  };

  const restore = (ctx: ExtensionContext): void => {
    pending = null;
    const stored = stateFromEntries(ctx.sessionManager.getBranch());
    if (stored) {
      state = stored;
    } else {
      state = initialState(getDefaultMode(ctx.cwd));
      pi.appendEntry(MODE_ENTRY, state);
    }
    render(ctx);
  };

  const handlePrompt = (text: string, ctx: ExtensionContext): PromptNote => {
    const outcome = applyPrompt(state, parseModeChange(text, { getDefaultMode: () => getDefaultMode(ctx.cwd) }));
    if (outcome.kind === 'status') return { kind: 'status', report: outcome.report };
    if (!sameState(outcome.next, state)) pi.appendEntry(MODE_ENTRY, outcome.next);
    state = outcome.next;
    render(ctx);
    return outcome.notice === null ? null : { kind: 'notice', text: outcome.notice };
  };

  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));

  pi.on('input', (event, ctx) => {
    if (/<scheduled-task\b/i.test(event.text)) return { action: 'continue' };
    const oneShot = ONE_SHOT_SKILL.exec(event.text);
    const bare = oneShot !== null && !/^\/caveman:/i.test(event.text);
    const prompt = bare ? pi.getCommands().find((command) => command.name === oneShot[1]?.toLowerCase()) : undefined;
    if (prompt?.source === 'prompt' && prompt.sourceInfo.path !== fileURLToPath(new URL(`../prompts/${oneShot?.[1]?.toLowerCase()}.md`, import.meta.url))) return { action: 'continue' };
    const note = handlePrompt(event.text, ctx);
    // Queued steer and follow-up text never reaches before_agent_start, so its notice has no turn to ride.
    if (event.streamingBehavior === undefined) pending = pendingFor(note);
    if (prompt?.source === 'prompt') return { action: 'continue' };
    if (!oneShot?.[1]) return { action: 'continue' };
    return { action: 'transform', text: `/skill:${oneShot[1].toLowerCase()}${event.text.slice(oneShot[0].length)}` };
  });

  pi.on('before_agent_start', (event, ctx) => {
    const mode = activeMode(state);
    const prose = mode !== null && isProseMode(mode) && getDefaultMode(ctx.cwd) !== 'off' ? mode : null;
    const systemPrompt = prose ? placeRuleset(rulesetSection(prose), event.systemPromptOptions) : undefined;
    // Upstream answers a status request without the per-turn reminder.
    const reminder = prose && pending?.reinforce !== false ? reinforcement(prose) : null;
    const context = [pending?.context ?? null, reminder].filter((line) => line !== null).join('\n\n');
    pending = null;
    const message = context ? { customType: 'caveman-context', content: context, display: false } : undefined;
    if (!message && !systemPrompt) return undefined;
    return { ...(message && { message }), ...(systemPrompt !== undefined && { systemPrompt }) };
  });

  return { active: () => activeMode(state), handlePrompt };
}
