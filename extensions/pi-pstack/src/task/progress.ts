// A foreground Task blocks the parent until the child settles. Cursor streams the child's conversation steps into the
// card meanwhile; Pi has no channel for them, so the child's own RPC events are reduced to a short progress line.
const STEP_LIMIT = 4;
const ARG_LIMIT = 80;
const LATEST_LIMIT = 120;
const THROTTLE_MS = 750;

export interface ProgressState {
  steps: string[];
  latest?: string;
  /** Steps run in total, since only the last few are kept. */
  count?: number;
}

/** One line for a tool that started, or undefined for another event. Long or structured arguments are shortened. */
export function stepLine(event: { type?: string; toolName?: string; args?: unknown }): string | undefined {
  if (event.type !== 'tool_execution_start' || typeof event.toolName !== 'string') return undefined;
  const args = event.args as Record<string, unknown> | undefined;
  const hint = args?.['command'] ?? args?.['path'] ?? args?.['pattern'] ?? args?.['description'] ?? '';
  const text = typeof hint === 'string' ? hint : '';
  const single = text.replace(/\s+/g, ' ').trim();
  const shown = single.length > ARG_LIMIT ? `${single.slice(0, ARG_LIMIT - 1)}…` : single;
  return shown === '' ? `· ${event.toolName}` : `· ${event.toolName}: ${shown}`;
}

/** The latest assistant prose, reduced to its first non-empty line. */
export function latestLine(event: { type?: string; message?: { role?: string; content?: unknown } }): string | undefined {
  if (event.type !== 'message_end' || event.message?.role !== 'assistant' || !Array.isArray(event.message.content)) return undefined;
  const text = (event.message.content as { type?: string; text?: string }[])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
  const line = text
    .split('\n')
    .find((candidate) => candidate.trim() !== '')
    ?.trim();
  if (line === undefined || line === '') return undefined;
  return line.length > LATEST_LIMIT ? `${line.slice(0, LATEST_LIMIT - 1)}…` : line;
}

/** The running card's body: how many steps ran, the last few, and the child's latest prose. */
export function progressText(state: ProgressState): string {
  const count = state.count ?? state.steps.length;
  const header = count === 0 ? 'Running…' : `Running: ${count} step${count === 1 ? '' : 's'}`;
  return [header, ...state.steps, ...(state.latest === undefined ? [] : ['', state.latest])].join('\n');
}

export type ProgressUpdate = { content: { type: 'text'; text: string }[]; details: unknown };
export type ProgressSend = (update: ProgressUpdate) => void;

export interface ProgressHandle {
  onEvent: (event: { type: string } & Record<string, unknown>) => void;
  stop: () => void;
}

/**
 * Feeds child events into one throttled card update. The first event sends at once so a slow child still shows
 * something; later ones are coalesced, and stop() drops a pending update so it cannot land after the final result.
 */
export function createProgress(update: ProgressSend | undefined, details: () => unknown, now: () => number = Date.now): ProgressHandle {
  const state: ProgressState = { steps: [], count: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = 0;
  let stopped = false;
  let stepped = false;

  const send = () => {
    timer = undefined;
    if (stopped) return;
    lastSent = now();
    update?.({ content: [{ type: 'text', text: progressText(state) }], details: details() });
  };
  const schedule = () => {
    if (update === undefined || stopped || timer !== undefined) return;
    if (lastSent === 0) {
      send();
      return;
    }
    timer = setTimeout(send, Math.max(0, THROTTLE_MS - (now() - lastSent)));
    timer.unref?.();
  };

  return {
    onEvent: (event) => {
      const step = stepLine(event);
      if (step !== undefined) {
        state.count = (state.count ?? 0) + 1;
        state.steps = [...state.steps, step].slice(-STEP_LIMIT);
        // The first tool step always shows, even when prose just reset the throttle, so the card is never stepless.
        if (stepped) {
          schedule();
        } else {
          stepped = true;
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          send();
        }
        return;
      }
      const latest = latestLine(event);
      if (latest !== undefined) {
        state.latest = latest;
        schedule();
      }
    },
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
