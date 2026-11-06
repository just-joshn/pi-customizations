import type { AgentActivityOutcome, BoundaryResult, ExtensionAPI, ExtensionContext, SessionBoundaryDraft } from '@earendil-works/pi-coding-agent';
import { isOneShot } from '../modes.ts';
import { type NotificationFields, notificationText } from './format.ts';
import type { ChildHandle, ChildOutcome } from './runner.ts';

export const NOTIFICATION_TYPE = 'pstack/task';

interface Running {
  settled: Promise<void>;
  handle: ChildHandle;
  background: boolean;
  /** A detached cloud agent: it outlives this runtime, so shutdown stops following it instead of killing it. */
  detached: boolean;
}

export interface TrackOptions {
  detached?: boolean;
  /** Runs after the notice is delivered (or right away without one), so a cloud agent's record can say the owner has it. */
  onDelivered?: () => void;
}

export interface BackgroundNotice {
  title: string;
  description: string;
  toolCallId: string;
  mode: ExtensionContext['mode'];
  detailFor: (outcome: ChildOutcome) => Pick<NotificationFields, 'status' | 'detail' | 'usage'>;
}

/**
 * Every running child of this runtime, foreground and background, so one agent ID never has two writers here.
 * Background completions become notices: a follow-up message in long-lived sessions, and a settle-time entry in
 * one-shot print and JSON runs, which wait for them before exiting.
 */
export function createSubagentRegistry(pi: ExtensionAPI) {
  const running = new Map<string, Running>();
  const pending: NotificationFields[] = [];
  let retired = false;

  const deliver = (fields: NotificationFields, mode: ExtensionContext['mode']) => {
    if (isOneShot(mode)) pending.push(fields);
    else pi.sendMessage({ customType: NOTIFICATION_TYPE, content: notificationText(fields), display: true, details: fields }, { triggerTurn: true, deliverAs: 'followUp' });
  };

  /** Registers synchronously, before any await in the caller, so a sibling call in the same message sees it. */
  const track = (agentId: string, handle: ChildHandle, release: () => void, notice?: BackgroundNotice, options: TrackOptions = {}) => {
    const settled = handle.done.then((outcome) => {
      running.delete(agentId);
      release();
      // Shutdown killed this child; the retired runtime's pi must not be touched.
      if (retired) return;
      if (notice !== undefined) deliver({ ...notice.detailFor(outcome), agentId, title: notice.title, description: notice.description, toolCallId: notice.toolCallId }, notice.mode);
      options.onDelivered?.();
    });
    running.set(agentId, { settled, handle, background: notice !== undefined, detached: options.detached === true });
  };

  const backgroundRunning = () => [...running.values()].filter((entry) => entry.background);

  /** An aborted run ends now: a one-shot run does not hold its exit for background subagents after Escape or a watchdog abort. */
  const beforeSettle = async (ctx: ExtensionContext, outcome: AgentActivityOutcome, entries: readonly SessionBoundaryDraft[]): Promise<BoundaryResult | undefined> => {
    if (!isOneShot(ctx.mode) || outcome === 'aborted' || (pending.length === 0 && backgroundRunning().length === 0)) return undefined;
    if (pending.length === 0) await Promise.race(backgroundRunning().map((entry) => entry.settled));
    const ready = pending.splice(0);
    // Appending keeps entries another extension proposed at this boundary; returning a fresh list would drop them.
    return {
      entries: [...entries, ...ready.map((fields) => ({ type: 'custom_message' as const, customType: NOTIFICATION_TYPE, content: notificationText(fields), display: true, details: fields }))],
      continue: true,
    };
  };

  /** Kills this runtime's children and stops following detached cloud agents, which keep running. */
  const shutdown = (): { stopped: number; detached: number } => {
    retired = true;
    const stopped = backgroundRunning().filter((entry) => !entry.detached).length;
    const detached = [...running.values()].filter((entry) => entry.detached).length;
    for (const entry of running.values()) {
      if (entry.detached) entry.handle.detach?.();
      else entry.handle.kill();
    }
    running.clear();
    pending.splice(0);
    return { stopped, detached };
  };

  return {
    isRunning: (agentId: string) => running.has(agentId),
    get: (agentId: string): Pick<Running, 'handle'> | undefined => running.get(agentId),
    /** Resolves after the agent's own notification, if this runtime follows it. */
    settledOf: (agentId: string): Promise<void> | undefined => running.get(agentId)?.settled,
    hasBackgroundWork: () => backgroundRunning().length > 0,
    track,
    beforeSettle,
    shutdown,
  };
}
