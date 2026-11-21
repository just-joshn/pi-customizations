import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { type Component, Container, Text, type TUI, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { formatGoalStatusText, isGoalActive, isGoalPaused } from './state.ts';
import { GOAL_STATUS_KEY, GOAL_WIDGET_KEY, type GoalState, type GoalToolDetails, type GoalToolKind, TICK_INTERVAL_MS, ZERO } from './types.ts';

type RenderStatus = 'pending' | 'success' | 'error' | 'cancelled';

const TOOL_LABELS: Readonly<Record<GoalToolKind, Readonly<{ readonly pending: string; readonly done: string; readonly cancelled: string }>>> = {
  create: { pending: 'Creating goal', done: 'Created goal', cancelled: 'Create goal' },
  update: { pending: 'Updating goal', done: 'Updated goal', cancelled: 'Update goal' },
};

function getToolLabel(kind: GoalToolKind, status: RenderStatus): string {
  const labels = TOOL_LABELS[kind];
  if (status === 'pending') {
    return labels.pending;
  }
  if (status === 'cancelled') {
    return labels.cancelled;
  }
  return labels.done;
}

function formatGoalHeader(theme: Theme, label: string, primary: string, status: RenderStatus): string {
  const styledLabel = status === 'cancelled' ? theme.fg('dim', theme.bold(label)) : theme.bold(label);
  const styledPrimary = primary.length > ZERO ? ` ${theme.fg('dim', primary)}` : '';
  return `  ${styledLabel}${styledPrimary}`;
}

export function renderGoalToolCall(kind: GoalToolKind, args: { readonly objective?: unknown; readonly status?: unknown }, theme: Theme): Text {
  const rawPrimary = kind === 'create' ? args.objective : args.status;
  const primary = typeof rawPrimary === 'string' ? rawPrimary : '';
  return new Text(formatGoalHeader(theme, getToolLabel(kind, 'pending'), primary, 'pending'), ZERO, ZERO);
}

function extractFallbackContentText(result: AgentToolResult<GoalToolDetails>): string | undefined {
  const firstText = result.content.find((part) => part.type === 'text');
  return firstText && 'text' in firstText && firstText.text.trim().length > ZERO ? firstText.text.trim() : undefined;
}

export function renderGoalToolResult(kind: GoalToolKind, result: AgentToolResult<GoalToolDetails>, options: { readonly expanded: boolean; readonly isPartial: boolean }, theme: Theme): Container {
  const container = new Container();
  const details = result.details;
  const status: RenderStatus = options.isPartial ? 'pending' : (details?.outcome ?? 'success');
  const primary = kind === 'create' ? (details?.objective ?? '') : (details?.status ?? '');
  const label = getToolLabel(kind, status);
  container.addChild(new Text(formatGoalHeader(theme, label, primary, status), ZERO, ZERO));
  const detailLine = status === 'error' ? details?.error : !options.isPartial && details === undefined ? extractFallbackContentText(result) : undefined;
  if (detailLine) {
    container.addChild(new Text(`  ${theme.fg('dim', detailLine)}`, ZERO, ZERO));
  }
  return container;
}

export function renderGoalContinuationMessage(theme: Theme): Text {
  return new Text(`  ${theme.bold('Continuing goal')}`, ZERO, ZERO);
}

function renderRightAlignedDimLine(text: string, width: number, theme: Theme): string {
  const truncated = truncateToWidth(text, width);
  const pad = Math.max(ZERO, width - visibleWidth(truncated));
  return `${' '.repeat(pad)}${theme.fg('dim', truncated)}`;
}

function isTickableGoal(getGoal: () => GoalState | undefined): boolean {
  const goal = getGoal();
  return isGoalActive(goal) && goal.lastAccruedAtMs !== undefined;
}

function startActiveGoalTicker(getGoal: () => GoalState | undefined, tui: TUI, onTick?: () => void): () => void {
  if (!isTickableGoal(getGoal)) {
    return () => undefined;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const handle = setInterval(() => {
    if (!isTickableGoal(getGoal)) {
      stop();
      return;
    }
    onTick?.();
    tui.requestRender();
  }, TICK_INTERVAL_MS);
  handle.unref?.();
  timer = handle;
  return stop;
}

export function createGoalStatusWidgetComponent(getGoal: () => GoalState | undefined, tui: TUI, theme: Theme, onTick?: () => void): Component & { readonly dispose: () => void } {
  const stopTicker = startActiveGoalTicker(getGoal, tui, onTick);
  return {
    render(width: number): string[] {
      const text = formatGoalStatusText(getGoal(), Date.now());
      if (text === undefined || width <= ZERO) {
        return [];
      }
      return [renderRightAlignedDimLine(text, width, theme)];
    },
    invalidate: (): void => undefined,
    dispose(): void {
      stopTicker();
    },
  };
}

export function syncGoalUi(ctx: ExtensionContext, getGoal: () => GoalState | undefined): void {
  if (!ctx.hasUI) {
    return;
  }
  const goal = getGoal();
  if (!isGoalActive(goal) && !isGoalPaused(goal)) {
    ctx.ui.setStatus(GOAL_STATUS_KEY, undefined);
    ctx.ui.setWidget(GOAL_WIDGET_KEY, undefined);
    return;
  }
  const updateFooterStatus = (): void => {
    const label = formatGoalStatusText(getGoal(), Date.now());
    ctx.ui.setStatus(GOAL_STATUS_KEY, label ? ctx.ui.theme.fg('dim', label) : undefined);
  };
  updateFooterStatus();
  ctx.ui.setWidget(GOAL_WIDGET_KEY, (tui, theme) => createGoalStatusWidgetComponent(getGoal, tui, theme, updateFooterStatus), {
    placement: 'aboveEditor',
  });
}
