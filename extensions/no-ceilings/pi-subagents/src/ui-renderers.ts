import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { type ExtensionContext, getMarkdownTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';
import { formatBackgroundCompletionHeader, formatDurationMs, formatRunningAgentsSummaryHeader, formatShortDescription, truncateByLines, truncateOutputPreview } from './formatters.ts';
import type { SubagentStore } from './store.ts';
import {
  BackgroundCompletionMessageDetailsSchema,
  DEFAULT_TASK_DESCRIPTION,
  MAX_COLLAPSED_STREAMING_LINES,
  MAX_COLLAPSED_THINKING_LINES,
  ONE,
  SUBAGENTS_STATUS_KEY,
  SUBAGENTS_WIDGET_KEY,
  type SubagentSessionRecord,
  type TaskToolDetails,
  ZERO,
} from './types.ts';

const BULLET_SEPARATOR = ' • ';
const PADDING_ZERO = 0;

function formatHeaderLine(theme: Theme, description: string, status: TaskToolDetails['status'], note: string | undefined): string {
  const glyph = status === 'success' ? theme.fg('success', '✓') : status === 'error' || status === 'cancelled' ? theme.fg('error', '✗') : theme.fg('warning', '●');
  const title = theme.fg('toolTitle', theme.bold('Task'));
  const primary = theme.fg('muted', description);
  const suffix = note ? `  ${theme.fg('dim', note)}` : '';
  return `${glyph} ${title} ${primary}${suffix}`;
}

export function renderTaskCall(args: Readonly<Record<string, unknown>>, theme: Theme): Text {
  const rawDesc = typeof args['description'] === 'string' && args['description'].trim().length > ZERO ? args['description'].trim() : DEFAULT_TASK_DESCRIPTION;
  const rawType = typeof args['subagent_type'] === 'string' && args['subagent_type'].trim().length > ZERO ? args['subagent_type'].trim() : undefined;
  const isBg = args['run_in_background'] === true;
  const noteParts = [rawType, isBg ? 'background' : undefined].filter((part): part is string => part !== undefined);
  const note = noteParts.length > ZERO ? noteParts.join(BULLET_SEPARATOR) : undefined;
  return new Text(formatHeaderLine(theme, rawDesc, 'pending', note), PADDING_ZERO, PADDING_ZERO);
}

function appendPendingBody(container: Container, details: TaskToolDetails, expanded: boolean, theme: Theme): void {
  const hasTool = Boolean(details.activeToolVerb);
  if (hasTool && details.activeToolVerb) {
    const toolText = details.activeToolDetail ? `${details.activeToolVerb} ${details.activeToolDetail}` : details.activeToolVerb;
    container.addChild(new Text(`  ${theme.fg('dim', toolText)}`, PADDING_ZERO, PADDING_ZERO));
  }
  if (details.streamingThinking && details.streamingThinking.trim().length > ZERO) {
    const clipped = expanded ? details.streamingThinking : truncateByLines(details.streamingThinking, MAX_COLLAPSED_THINKING_LINES).text;
    container.addChild(new Text(`  ${theme.fg('dim', clipped)}`, PADDING_ZERO, PADDING_ZERO));
  }
  if (expanded && details.transcriptText && details.transcriptText.trim().length > ZERO) {
    container.addChild(new Text(`  ${theme.fg('dim', 'Chat so far')}`, PADDING_ZERO, PADDING_ZERO));
    container.addChild(new Markdown(details.transcriptText, PADDING_ZERO, PADDING_ZERO, getMarkdownTheme()));
    return;
  }
  if (details.streamingText && details.streamingText.trim().length > ZERO) {
    const clipped = expanded ? details.streamingText : truncateByLines(details.streamingText, MAX_COLLAPSED_STREAMING_LINES).text;
    container.addChild(new Text(`  ${theme.fg('toolOutput', clipped)}`, PADDING_ZERO, PADDING_ZERO));
    return;
  }
  if (!hasTool && !details.streamingThinking) {
    const fallback = details.currentStep || 'Waiting for subagent to finish…';
    container.addChild(new Text(`  ${theme.fg('dim', fallback)}`, PADDING_ZERO, PADDING_ZERO));
  }
}

export function renderTaskResult(result: AgentToolResult<TaskToolDetails>, options: { readonly expanded: boolean; readonly isPartial: boolean }, theme: Theme): Container {
  const container = new Container();
  const details = result.details;
  if (!details) {
    const firstText = result.content.find((c) => c.type === 'text');
    const text = firstText && 'text' in firstText ? firstText.text : '(no output)';
    container.addChild(new Text(theme.fg('toolOutput', text), PADDING_ZERO, PADDING_ZERO));
    return container;
  }
  const durationLabel = formatDurationMs(details.durationMs);
  const attemptsLabel = details.attempts > ONE ? `attempt ${details.attempts}/${details.maxAttempts}` : undefined;
  const noteParts = [details.subagentType, details.isBackground ? 'background' : undefined, details.worktreePath ? 'worktree' : undefined, attemptsLabel, durationLabel].filter((part): part is string => part !== undefined);
  const note = noteParts.length > ZERO ? noteParts.join(BULLET_SEPARATOR) : undefined;
  const headerStatus = options.isPartial ? 'pending' : details.status;
  container.addChild(new Text(formatHeaderLine(theme, details.description || DEFAULT_TASK_DESCRIPTION, headerStatus, note), PADDING_ZERO, PADDING_ZERO));

  if (options.isPartial || details.status === 'pending' || (details.status === 'running' && !details.isBackground)) {
    appendPendingBody(container, details, options.expanded, theme);
    return container;
  }
  if (details.isBackground && details.status === 'running') {
    container.addChild(new Text(`  ${theme.fg('dim', `Running in background (${details.agentId})`)}`, PADDING_ZERO, PADDING_ZERO));
    return container;
  }
  if (details.status === 'error' || details.status === 'cancelled') {
    const errorMsg = details.error || 'Unknown error';
    const identifier = details.failureId ? ` [${details.failureId}${details.errorCode ? ` ${details.errorCode}` : ''}]` : '';
    container.addChild(new Text(`  ${theme.fg('error', `Error${identifier}: ${errorMsg}`)}`, PADDING_ZERO, PADDING_ZERO));
    return container;
  }
  if (details.worktreePath !== undefined) {
    container.addChild(new Text(`  ${theme.fg('dim', `worktree ${details.branch ?? ''} at ${details.worktreePath}`)}`, PADDING_ZERO, PADDING_ZERO));
  }
  if (details.finalMessage && details.finalMessage.trim().length > ZERO) {
    container.addChild(new Spacer(ONE));
    container.addChild(new Text(`  ${theme.fg('dim', 'Last output')}`, PADDING_ZERO, PADDING_ZERO));
    if (options.expanded) {
      container.addChild(new Markdown(details.finalMessage.trim(), PADDING_ZERO, PADDING_ZERO, getMarkdownTheme()));
    } else {
      const preview = truncateOutputPreview(details.finalMessage);
      container.addChild(new Text(`  ${theme.fg('toolOutput', preview.text)}`, PADDING_ZERO, PADDING_ZERO));
    }
  }
  return container;
}

export function renderBackgroundCompletionMessage(message: { readonly details?: unknown; readonly content: unknown }, theme: Theme): Text {
  const parsed = BackgroundCompletionMessageDetailsSchema.safeParse(message.details);
  const completions = parsed.success ? parsed.data.completions : [];
  const header = formatBackgroundCompletionHeader(completions);
  if (header.isGrouped) {
    const titlePart = header.title ? ` [${header.title}]` : '';
    return new Text(theme.bold(`${header.label}${titlePart}`), PADDING_ZERO, PADDING_ZERO);
  }
  const titlePart = header.title ? ` ${header.title}` : '';
  return new Text(`${theme.bold(header.label)}${titlePart}`, PADDING_ZERO, PADDING_ZERO);
}

function formatAgentWidgetLines(theme: Theme, session: SubagentSessionRecord): readonly string[] {
  const desc = formatShortDescription(session.description);
  const isDone = session.status === 'success';
  const isAborted = session.status === 'error' || session.status === 'cancelled';
  const descLine = isDone || isAborted ? `  ${theme.fg('dim', desc)}` : `  ${desc}`;
  const stepText = isAborted ? session.error || 'Cancelled' : isDone ? 'Done' : session.isBackground ? 'Running in background' : session.currentStep || 'Working…';
  const stepLine = isAborted ? `  ${theme.fg('error', `✗ ${stepText}`)}` : isDone ? `  ${theme.fg('success', `✓ ${stepText}`)}` : `  ${theme.fg('dim', stepText)}`;
  return [descLine, stepLine];
}

export function syncSubagentsUi(ctx: ExtensionContext, store: SubagentStore): void {
  if (!ctx.hasUI) {
    return;
  }
  const active = store.listActiveSessions();
  if (active.length === ZERO) {
    ctx.ui.setStatus(SUBAGENTS_STATUS_KEY, undefined);
    ctx.ui.setWidget(SUBAGENTS_WIDGET_KEY, undefined);
    return;
  }
  const statusLabel = active.length === ONE ? '1 task running (/tasks)' : `${active.length} tasks running (/tasks)`;
  ctx.ui.setStatus(SUBAGENTS_STATUS_KEY, ctx.ui.theme.fg('accent', statusLabel));
  const header = ctx.ui.theme.bold(formatRunningAgentsSummaryHeader(store.listSessions()));
  const body = active.flatMap((session) => formatAgentWidgetLines(ctx.ui.theme, session));
  ctx.ui.setWidget(SUBAGENTS_WIDGET_KEY, [header, ...body]);
}
