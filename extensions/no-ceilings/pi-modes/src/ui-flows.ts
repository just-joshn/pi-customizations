import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { formatDebugLogWidgetLines, readDebugLogPreview } from './debug-logs.ts';
import { formatCustomModeBadge, resolveModeColorToken } from './mode-colors.ts';
import { type CustomModeSkill, DEBUG_LOGS_WIDGET_KEY, EXECUTION_STATUS_KEY, MAX_TODO_DISPLAY_LEN, MODE_IDS, MODE_SPECS, type ModeId, type ModesRuntimeState, ONE, PLAN_WIDGET_KEY, STATUS_KEY, TRUNCATE_ELLIPSIS_LEN, ZERO } from './types.ts';

export const PLAN_CHOICE_BUILD = '1. Yes, build locally';
export const PLAN_CHOICE_REVISE = '2. No, propose changes';

const CUSTOM_ICON_INPUT_LABEL = 'Custom icon…';
const CUSTOM_ICON_INPUT_PLACEHOLDER = '⚡';

export const DEBUG_CHOICE_PROCEED = '1. Proceed (Issue reproduced)';
export const DEBUG_CHOICE_FIXED = '2. Mark as fixed (Clean up instrumentation)';
export const DEBUG_CHOICE_FOLLOWUP = '3. Write a follow-up';
export const DEBUG_CHOICE_DISMISS = '4. Dismiss';

export const DEBUG_PROCEED_MESSAGE = 'Issue reproduced, please proceed';
export const DEBUG_MARK_FIXED_MESSAGE = 'The issue has been fixed. Please clean up the instrumentation.';

function renderModeBadge(ctx: ExtensionContext, state: ModesRuntimeState): string | undefined {
  if (state.customMode !== undefined) {
    return ctx.ui.theme.fg(resolveModeColorToken(state.customMode.colorId), formatCustomModeBadge(state.customMode.label, state.customMode.icon));
  }
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

/** The custom mode owns the primary badge, so the execution mode gets its own slot while it constrains tools. */
function renderExecutionBadge(ctx: ExtensionContext, state: ModesRuntimeState): string | undefined {
  if (state.customMode === undefined || state.mode === 'agent') {
    return undefined;
  }
  const spec = MODE_SPECS[state.mode];
  return ctx.ui.theme.fg(spec.badgeColor ?? 'muted', spec.label);
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
  ctx.ui.setStatus(EXECUTION_STATUS_KEY, renderExecutionBadge(ctx, state));
  ctx.ui.setWidget(PLAN_WIDGET_KEY, renderPlanTodoLines(ctx, state));
  const debugLines = state.mode === 'debug' ? [...formatDebugLogWidgetLines(readDebugLogPreview(ctx.cwd, ctx.sessionManager.getSessionId()))] : undefined;
  ctx.ui.setWidget(DEBUG_LOGS_WIDGET_KEY, debugLines);
}

export type ModePickerChoice = { readonly kind: 'builtin'; readonly id: ModeId } | { readonly kind: 'custom'; readonly id: string };

function formatBuiltinOption(mode: ModeId, state: ModesRuntimeState): string {
  const spec = MODE_SPECS[mode];
  const activeMark = mode === state.mode && state.customMode === undefined ? ' (active)' : '';
  return `${spec.label}${activeMark} — ${spec.description}`;
}

function formatCustomOption(mode: CustomModeSkill, activeCustomModeId: string | undefined): string {
  const prefix = mode.icon ? `${mode.icon} ` : '';
  const activeMark = mode.id === activeCustomModeId ? ' (active)' : '';
  return `${prefix}${mode.label}${activeMark} — ${mode.description}`;
}

export async function promptModePicker(ctx: ExtensionContext, state: ModesRuntimeState, customModes: readonly CustomModeSkill[]): Promise<ModePickerChoice | undefined> {
  if (!ctx.hasUI) {
    return undefined;
  }
  const builtinOptions = MODE_IDS.map((mode) => formatBuiltinOption(mode, state));
  const customOptions = customModes.map((mode) => formatCustomOption(mode, state.customMode?.id));
  // Selection returns the rendered row, so a row must be unique across built-in and custom options.
  const counts = new Map<string, number>();
  for (const option of [...builtinOptions, ...customOptions]) {
    counts.set(option, (counts.get(option) ?? ZERO) + 1);
  }
  const uniqueCustomOptions = customOptions.map((option, index) => ((counts.get(option) ?? ZERO) > ONE ? `${option} (${customModes[index]?.id ?? ''})` : option));
  const options = [...builtinOptions, ...uniqueCustomOptions];
  const selected = await ctx.ui.select('Select execution mode:', options);
  if (!selected) {
    return undefined;
  }
  const index = options.indexOf(selected);
  const builtin = MODE_IDS[index];
  if (builtin) {
    return { kind: 'builtin', id: builtin };
  }
  const custom = customModes[index - MODE_IDS.length];
  return custom ? { kind: 'custom', id: custom.id } : undefined;
}

export async function promptColorPicker(ctx: ExtensionContext, colors: readonly string[], currentColorId: string | undefined): Promise<string | undefined> {
  if (!ctx.hasUI) {
    return undefined;
  }
  const options = colors.map((colorId) => (colorId === currentColorId ? `${colorId} (active)` : colorId));
  const selected = await ctx.ui.select('Select mode color:', options);
  return selected ? colors[options.indexOf(selected)] : undefined;
}

export async function promptIconPicker(ctx: ExtensionContext, icons: readonly string[], currentIcon: string | undefined): Promise<string | undefined> {
  if (!ctx.hasUI) {
    return undefined;
  }
  const options = icons.map((icon) => (icon === currentIcon ? `${icon} (active)` : icon));
  const selected = await ctx.ui.select('Select mode icon:', [...options, CUSTOM_ICON_INPUT_LABEL]);
  if (!selected) {
    return undefined;
  }
  if (selected === CUSTOM_ICON_INPUT_LABEL) {
    const typed = (await ctx.ui.input('Enter a mode icon:', CUSTOM_ICON_INPUT_PLACEHOLDER))?.trim();
    return typed && typed.length > ZERO ? typed : undefined;
  }
  return icons[options.indexOf(selected)];
}

export async function promptPlanDecision(ctx: ExtensionContext, planSummary: string): Promise<'build' | 'revise' | 'stay'> {
  if (!ctx.hasUI) {
    return 'stay';
  }
  const choice = await ctx.ui.select(`Ready to build? ${planSummary}`, [PLAN_CHOICE_BUILD, PLAN_CHOICE_REVISE]);
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
