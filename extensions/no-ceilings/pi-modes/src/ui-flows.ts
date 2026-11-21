import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { formatDebugLogWidgetLines, readDebugLogPreview } from './debug-logs.ts';
import { DEBUG_LOGS_WIDGET_KEY, MAX_TODO_DISPLAY_LEN, MODE_IDS, MODE_SPECS, type ModeId, type ModesRuntimeState, PLAN_WIDGET_KEY, STATUS_KEY, TRUNCATE_ELLIPSIS_LEN, ZERO } from './types.ts';

export const PLAN_CHOICE_BUILD = '1. Yes, build locally';
export const PLAN_CHOICE_REVISE = '2. No, propose changes';
export const PLAN_CHOICE_STAY = '3. Stay in Plan mode';

export const DEBUG_CHOICE_PROCEED = '1. Proceed (Issue reproduced)';
export const DEBUG_CHOICE_FIXED = '2. Mark as fixed (Clean up instrumentation)';
export const DEBUG_CHOICE_FOLLOWUP = '3. Write a follow-up';
export const DEBUG_CHOICE_DISMISS = '4. Dismiss';

export const DEBUG_PROCEED_MESSAGE = 'Issue reproduced, please proceed';
export const DEBUG_MARK_FIXED_MESSAGE = 'The issue has been fixed. Please clean up the instrumentation.';

function renderModeBadge(ctx: ExtensionContext, state: ModesRuntimeState): string | undefined {
  const spec = MODE_SPECS[state.mode];
  if (spec.badgeColor) {
    return ctx.ui.theme.fg(spec.badgeColor, `${spec.label} (ctrl+alt+m to cycle)`);
  }
  if (state.planExecuting && state.planSteps.length > ZERO) {
    const done = state.planSteps.filter((step) => step.completed).length;
    return ctx.ui.theme.fg('accent', `Agent · Plan ${done}/${state.planSteps.length}`);
  }
  return undefined;
}

function renderPlanTodoLines(ctx: ExtensionContext, state: ModesRuntimeState): string[] | undefined {
  if (!state.planExecuting || state.planSteps.length === ZERO) {
    return undefined;
  }
  const maxTextLen = MAX_TODO_DISPLAY_LEN - TRUNCATE_ELLIPSIS_LEN;
  return state.planSteps.map((step) => {
    const clipped = step.text.length > MAX_TODO_DISPLAY_LEN ? `${step.text.slice(ZERO, maxTextLen)}...` : step.text;
    if (step.completed) {
      return `${ctx.ui.theme.fg('success', '☑ ')}${ctx.ui.theme.fg('muted', ctx.ui.theme.strikethrough(clipped))}`;
    }
    return `${ctx.ui.theme.fg('muted', '☐ ')}${clipped}`;
  });
}

export function syncModeUi(ctx: ExtensionContext, state: ModesRuntimeState): void {
  if (!ctx.hasUI) {
    return;
  }
  ctx.ui.setStatus(STATUS_KEY, renderModeBadge(ctx, state));
  ctx.ui.setWidget(PLAN_WIDGET_KEY, renderPlanTodoLines(ctx, state));
  const debugLines = state.mode === 'debug' ? [...formatDebugLogWidgetLines(readDebugLogPreview(ctx.cwd, ctx.sessionManager.getSessionId()))] : undefined;
  ctx.ui.setWidget(DEBUG_LOGS_WIDGET_KEY, debugLines);
}

export async function promptModePicker(ctx: ExtensionContext, currentMode: ModeId): Promise<ModeId | undefined> {
  if (!ctx.hasUI) {
    return undefined;
  }
  const options = MODE_IDS.map((id) => {
    const spec = MODE_SPECS[id];
    const activeMark = id === currentMode ? ' (active)' : '';
    return `${spec.label}${activeMark} — ${spec.description}`;
  });
  const selected = await ctx.ui.select('Select execution mode:', options);
  return selected ? MODE_IDS[options.indexOf(selected)] : undefined;
}

export async function promptPlanDecision(ctx: ExtensionContext, planSummary: string): Promise<'build' | 'revise' | 'stay'> {
  if (!ctx.hasUI) {
    return 'stay';
  }
  const choice = await ctx.ui.select(`Ready to build? ${planSummary}`, [PLAN_CHOICE_BUILD, PLAN_CHOICE_REVISE, PLAN_CHOICE_STAY]);
  if (choice === PLAN_CHOICE_BUILD) {
    return 'build';
  }
  return choice === PLAN_CHOICE_REVISE ? 'revise' : 'stay';
}

export async function promptDebugDecision(ctx: ExtensionContext, reproductionSteps: string): Promise<{ action: 'proceed' | 'mark-fixed' | 'follow-up' | 'dismiss'; followUp?: string }> {
  if (!ctx.hasUI) {
    return { action: 'dismiss' };
  }
  const header = `Reproduction Steps:\n${reproductionSteps}\n\nReady to proceed?`;
  const choice = await ctx.ui.select(header, [DEBUG_CHOICE_PROCEED, DEBUG_CHOICE_FIXED, DEBUG_CHOICE_FOLLOWUP, DEBUG_CHOICE_DISMISS]);
  if (choice === DEBUG_CHOICE_PROCEED) {
    return { action: 'proceed' };
  }
  if (choice === DEBUG_CHOICE_FIXED) {
    return { action: 'mark-fixed' };
  }
  if (choice === DEBUG_CHOICE_FOLLOWUP) {
    const trimmed = (await ctx.ui.input('Write your follow-up:', 'Add more detail…'))?.trim();
    return trimmed ? { action: 'follow-up', followUp: trimmed } : { action: 'dismiss' };
  }
  return { action: 'dismiss' };
}
