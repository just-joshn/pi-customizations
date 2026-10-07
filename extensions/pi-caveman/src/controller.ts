import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getDefaultMode } from './config.ts';
import { badgeFor, isProseMode, type Mode } from './modes.ts';
import { parseModeChange } from './parse.ts';
import { reinforcement, rulesetSection } from './ruleset.ts';
import { activeMode, applyPrompt, initialState, MODE_ENTRY, type ModeState, OFF, sameState, stateFromEntries } from './state.ts';

const STATUS_KEY = 'caveman';
const ONE_SHOT_SKILL = /^\/(?:caveman:)?(caveman-(?:commit|review|compress))(?=\s|$)/i;

export interface ModeController {
  readonly active: () => Mode | null;
  readonly handlePrompt: (text: string, ctx: ExtensionContext) => string | null;
}

export function registerModeTracking(pi: ExtensionAPI): ModeController {
  let state: ModeState = OFF;
  let pendingNotice: string | null = null;

  const render = (ctx: ExtensionContext): void => {
    const mode = activeMode(state);
    ctx.ui.setStatus(STATUS_KEY, mode ? ctx.ui.theme.fg('warning', badgeFor(mode)) : undefined);
  };

  const restore = (ctx: ExtensionContext): void => {
    pendingNotice = null;
    const stored = stateFromEntries(ctx.sessionManager.getBranch());
    if (stored) {
      state = stored;
    } else {
      state = initialState(getDefaultMode(ctx.cwd));
      pi.appendEntry(MODE_ENTRY, state);
    }
    render(ctx);
  };

  const handlePrompt = (text: string, ctx: ExtensionContext): string | null => {
    const outcome = applyPrompt(state, parseModeChange(text, { getDefaultMode: () => getDefaultMode(ctx.cwd) }));
    if (outcome.kind === 'status') return outcome.report;
    if (!sameState(outcome.next, state)) pi.appendEntry(MODE_ENTRY, outcome.next);
    state = outcome.next;
    render(ctx);
    return outcome.notice;
  };

  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));

  pi.on('input', (event, ctx) => {
    if (/<scheduled-task\b/i.test(event.text)) return { action: 'continue' };
    const notice = handlePrompt(event.text, ctx);
    // Queued steer and follow-up text never reaches before_agent_start, so its notice has no turn to ride.
    if (event.streamingBehavior === undefined) pendingNotice = notice;
    const oneShot = ONE_SHOT_SKILL.exec(event.text);
    if (!oneShot?.[1]) return { action: 'continue' };
    return { action: 'transform', text: `/skill:${oneShot[1].toLowerCase()}${event.text.slice(oneShot[0].length)}` };
  });

  pi.on('before_agent_start', (event, ctx) => {
    const mode = activeMode(state);
    const prose = mode !== null && isProseMode(mode) && getDefaultMode(ctx.cwd) !== 'off' ? mode : null;
    if (prose) event.systemPromptOptions.sections['caveman'] = rulesetSection(prose);
    const context = [pendingNotice, prose ? reinforcement(prose) : null].filter((line) => line !== null).join('\n\n');
    pendingNotice = null;
    return context ? { message: { customType: 'caveman-context', content: context, display: false } } : undefined;
  });

  return { active: () => activeMode(state), handlePrompt };
}
