import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { type Component, Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { formatElapsedCompact, formatSessionTitle, truncateEnd } from './formatters.ts';
import type { SubagentStore } from './store.ts';
import { isActiveSubagentStatus, ONE, type SubagentSessionRecord, ZERO } from './types.ts';

const REFRESH_INTERVAL_MS = 1000;
const HEADER_RESERVED_WIDTH = 6;
const MIN_CONTENT_WIDTH = 20;
const ACTIVE_POINTER = '▸ ';
const INACTIVE_POINTER = '  ';
const MAX_TRANSCRIPT_LINES = 24;

interface OverlayViewState {
  readonly view: 'list' | 'transcript';
  readonly selectedIndex: number;
  readonly activeAgentId?: string | undefined;
}

function renderTaskListLines(sessions: readonly SubagentSessionRecord[], selectedIndex: number, width: number, theme: Theme, now: number): string[] {
  const countLabel = `${sessions.length} ${sessions.length === ONE ? 'task' : 'tasks'}`;
  const header = `${theme.bold('Tasks')} ${theme.fg('dim', `(${countLabel})`)}`;
  const innerWidth = Math.max(MIN_CONTENT_WIDTH, width - HEADER_RESERVED_WIDTH);

  if (sessions.length === ZERO) {
    return [header, '', `  ${theme.fg('dim', 'No active tasks')}`, '', theme.fg('dim', 'Esc or q to close')];
  }
  const rows = sessions.map((session, idx) => {
    const selected = idx === selectedIndex;
    const pointer = selected ? ACTIVE_POINTER : INACTIVE_POINTER;
    const isRunning = isActiveSubagentStatus(session.status);
    const elapsed = selected && isRunning ? `  ${formatElapsedCompact(Math.max(ZERO, now - session.startedAt))}` : '';
    const badge = session.isBackground ? ' [bg]' : isRunning ? ' [fg]' : ` [${session.status}]`;
    const retry = session.attempts > ONE ? ` [try ${session.attempts}/${session.maxAttempts}]` : '';
    const failure = session.failureId === undefined ? '' : ` ${session.failureId}`;
    const suffix = `${badge}${retry}${failure}${elapsed}`;
    const maxTitleLen = Math.max(ONE, innerWidth - pointer.length - suffix.length);
    const title = truncateEnd(formatSessionTitle(session.description, session.prompt, session.agentId), maxTitleLen);
    const line = `${pointer}${selected ? theme.bold(title) : title}${theme.fg('dim', suffix)}`;
    return selected ? theme.fg('accent', line) : line;
  });

  const active = sessions[selectedIndex];
  const activeRunning = active !== undefined && isActiveSubagentStatus(active.status);
  const canKill = activeRunning;
  const canBg = activeRunning && !active.isBackground;
  const hints = [sessions.length > ONE ? '↑/↓ navigate' : undefined, 'Enter to view', canKill ? 'k to abort' : undefined, canBg ? 'b to background' : undefined, 'Esc to close'].filter((h): h is string => h !== undefined).join('  ·  ');

  return [header, '', ...rows, '', theme.fg('dim', hints)];
}

function renderTranscriptLines(session: SubagentSessionRecord | undefined, theme: Theme): string[] {
  if (!session) {
    return [theme.fg('dim', "This subagent's live transcript is no longer available."), '', theme.fg('dim', 'esc to go back')];
  }
  const title = formatSessionTitle(session.description, session.prompt, session.agentId);
  const itemLines = session.transcriptItems.flatMap((item) => {
    if (item.role === 'user') {
      return [theme.bold(`> ${item.text}`)];
    }
    if (item.role === 'tool') {
      return [theme.fg('dim', `  → ${item.toolSummary || item.text}`)];
    }
    if (item.role === 'result') {
      return [theme.fg('dim', `    ${item.text.split('\n').join('\n    ')}`)];
    }
    if (item.role === 'thinking') {
      return [theme.fg('dim', item.text)];
    }
    return item.text.split('\n');
  });
  const liveThinking = session.streamingThinking ? session.streamingThinking.split('\n').map((line) => theme.fg('dim', line)) : [];
  const liveLines = [...liveThinking, ...(session.streamingText ? session.streamingText.split('\n') : []), ...(isActiveSubagentStatus(session.status) ? ['', `${theme.fg('success', '●')} ${theme.bold('Working')}`] : [])];
  const retained =
    session.transcriptItems.length === ZERO && session.transcriptPath !== undefined && !isActiveSubagentStatus(session.status) ? [theme.fg('dim', 'The live transcript is no longer retained.'), theme.fg('dim', session.transcriptPath)] : [];
  const combined = [...retained, ...itemLines, ...liveLines].slice(-MAX_TRANSCRIPT_LINES);
  const footer = theme.fg('dim', `Subagent · ${title}  ·  esc to go back`);
  return [...combined, '', footer];
}

function clampIndex(index: number, length: number): number {
  if (length <= ZERO) {
    return ZERO;
  }
  return Math.max(ZERO, Math.min(index, length - ONE));
}

function isEscapeOrQuit(data: string): boolean {
  return matchesKey(data, Key.escape) || data === 'q' || matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'));
}

function reduceListInput(data: string, prev: OverlayViewState, store: SubagentStore, done: () => void): OverlayViewState {
  if (isEscapeOrQuit(data)) {
    done();
    return prev;
  }
  const sessions = store.listSessions();
  if (sessions.length === ZERO) {
    return prev;
  }
  if (matchesKey(data, Key.up) || data === 'K') {
    return { ...prev, selectedIndex: clampIndex(prev.selectedIndex - ONE, sessions.length) };
  }
  if (matchesKey(data, Key.down) || data === 'j') {
    return { ...prev, selectedIndex: clampIndex(prev.selectedIndex + ONE, sessions.length) };
  }
  if (data === 'g') {
    return { ...prev, selectedIndex: ZERO };
  }
  if (data === 'G') {
    return { ...prev, selectedIndex: clampIndex(sessions.length - ONE, sessions.length) };
  }
  const current = sessions[clampIndex(prev.selectedIndex, sessions.length)];
  if (!current) {
    return prev;
  }
  if (matchesKey(data, Key.enter)) {
    return { ...prev, view: 'transcript', activeAgentId: current.agentId };
  }
  if (data === 'k' && current !== undefined && isActiveSubagentStatus(current.status)) {
    store.abortRun(current.agentId);
  } else if (data === 'b' && !current.isBackground) {
    store.getActiveRun(current.agentId)?.requestBackground?.();
  }
  return prev;
}

function renderCurrentOverlayView(viewState: OverlayViewState, store: SubagentStore, width: number, theme: Theme): string[] {
  const sessions = store.listSessions();
  if (viewState.view === 'transcript') {
    const active = viewState.activeAgentId ? store.getSession(viewState.activeAgentId) : undefined;
    return renderTranscriptLines(active, theme);
  }
  return renderTaskListLines(sessions, clampIndex(viewState.selectedIndex, sessions.length), width, theme, Date.now());
}

function createTasksOverlayComponent(store: SubagentStore, theme: Theme, requestRender: () => void, done: () => void): Component & { readonly dispose: () => void } {
  let viewState: OverlayViewState = { view: 'list', selectedIndex: ZERO };
  const unsubscribe = store.subscribe(() => requestRender());
  const timer = setInterval(() => requestRender(), REFRESH_INTERVAL_MS);
  timer.unref?.();

  return {
    render(width: number): string[] {
      return renderCurrentOverlayView(viewState, store, width, theme).map((line) => truncateToWidth(line, width, undefined, true));
    },
    handleInput(data: string): void {
      if (viewState.view === 'transcript' && !isEscapeOrQuit(data)) {
        return;
      }
      if (viewState.view === 'transcript') {
        viewState = { ...viewState, view: 'list', activeAgentId: undefined };
        requestRender();
        return;
      }
      viewState = reduceListInput(data, viewState, store, done);
      requestRender();
    },
    invalidate(): void {
      return undefined;
    },
    dispose(): void {
      clearInterval(timer);
      unsubscribe();
    },
  };
}

export async function openTasksOverlay(ctx: ExtensionContext, store: SubagentStore): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) =>
      createTasksOverlayComponent(
        store,
        theme,
        () => tui.requestRender(),
        () => done(undefined),
      ),
    { overlay: true },
  );
}
