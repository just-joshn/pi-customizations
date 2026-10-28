import type { AgentActivityOutcome, BoundaryResult, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { isOneShot } from '../modes.ts';
import { type NotificationFields, notificationText } from './format.ts';
import type { ChildHandle, ChildOutcome } from './runner.ts';

export const NOTIFICATION_TYPE = 'pstack/task';

interface Running {
  settled: Promise<void>;
  handle: ChildHandle;
  /** How the child runs now, which can be stricter than its record (plan mode). */
  readonly: boolean;
  background: boolean;
}

export interface BackgroundNotice {
  title: string;
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
  const track = (agentId: string, handle: ChildHandle, release: () => void, readonly: boolean, notice?: BackgroundNotice) => {
    const settled = handle.done.then((outcome) => {
      running.delete(agentId);
      release();
      // Shutdown killed this child; the retired runtime's pi must not be touched.
      if (retired || notice === undefined) return;
      deliver({ ...notice.detailFor(outcome), agentId, title: notice.title, toolCallId: notice.toolCallId }, notice.mode);
    });
    running.set(agentId, { settled, handle, readonly, background: notice !== undefined });
  };

  const backgroundRunning = () => [...running.values()].filter((entry) => entry.background);

  /** An aborted run ends now: a one-shot run does not hold its exit for background subagents after Escape or a watchdog abort. */
  const beforeSettle = async (ctx: ExtensionContext, outcome: AgentActivityOutcome): Promise<BoundaryResult | undefined> => {
    if (!isOneShot(ctx.mode) || outcome === 'aborted' || (pending.length === 0 && backgroundRunning().length === 0)) return undefined;
    if (pending.length === 0) await Promise.race(backgroundRunning().map((entry) => entry.settled));
    const ready = pending.splice(0);
    return { entries: ready.map((fields) => ({ type: 'custom_message' as const, customType: NOTIFICATION_TYPE, content: notificationText(fields), display: true, details: fields })), continue: true };
  };

  const shutdown = (): number => {
    retired = true;
    const background = backgroundRunning().length;
    for (const entry of running.values()) entry.handle.kill();
    running.clear();
    pending.splice(0);
    return background;
  };

  return { isRunning: (agentId: string) => running.has(agentId), get: (agentId: string): Pick<Running, 'handle' | 'readonly'> | undefined => running.get(agentId), hasBackgroundWork: () => backgroundRunning().length > 0, track, beforeSettle, shutdown };
}
