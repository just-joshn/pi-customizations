// The trusted parent side of a Benny-style automation: one event source feeds an append-only event store, each new
// case gets one tmux worker with no posting capability, and the parent alone performs external posts through an outbox
// it reconciles against the destination.
import { execFileSync } from 'node:child_process';

import { type DispatchConfig, dispatchRun, missingPrerequisites, type SpawnWorker, spawnInTmux } from '../src/automation/dispatch.ts';
import { type ActionId, AUTOMATION_KINDS, classificationOf, eligibleTrackerAction, failureReply, sourceUrlOf, type TrackerConfig, type TrackerEligibility, type TrackerIntent, type WorkerResult, type AutomationEvent, actionIdFor, type EventKey, isIdentifier, type Prerequisite, type Probe, parseEvent, type RunId, runIdFor } from '../src/automation/model.ts';
import { directLander, enqueue, flushOutbox, type ThreadDestination, type TrackerDestination, type TrackerLander } from '../src/automation/outbox.ts';
import { pollSlackOnce, type SlackApi } from '../src/automation/slack.ts';
import { type AutomationStore, acquireSourceLock, appendLog, automationStore, type LogEntry, outboxEntries, readLog } from '../src/automation/store.ts';
import { startWebhookReceiver } from '../src/automation/webhook.ts';

export { createRoutine, startRoutineSource, type RoutineConfig } from '../src/automation/routine.ts';

export interface AutomationConfig extends DispatchConfig {
  /** The only channel this automation accepts events from. */
  sourceChannelId: string;
  triageIdentityUserId?: string;
  tracker?: TrackerConfig;
}

export interface AutomationDeps {
  /** Defaults to a tmux worker started as pstack_worker starts one. */
  spawnWorker?: SpawnWorker;
  /** A synchronous tracker the parent writes itself, or a lander that hands each write to a worker. */
  tracker?: TrackerDestination | TrackerLander;
  /** Trusted parent reads source and tracker state independently. Never take eligibility from the worker result. */
  trackerPolicy?: (event: AutomationEvent, intent: TrackerIntent, reply: string) => Promise<TrackerEligibility>;
  destination: ThreadDestination;
  /** A required prerequisite with no probe counts as missing. */
  prerequisites: Partial<Record<Prerequisite, Probe>>;
  inputCommit?: () => string;
  now?: () => Date;
}

export type HandleOutcome =
  | { status: 'rejected'; reason: string }
  | { status: 'blocked'; key: EventKey; missing: Prerequisite[]; problems?: string[] }
  | { status: 'dispatched'; key: EventKey; runId: RunId }
  | { status: 'duplicate'; key: EventKey; runId: RunId };

/**
 * `retrying`: an action is still pending and the next attempt is owed; the run stays pending and `complete` is called again.
 * `failed`: the reply could not land after the retry limit. The run is closed, and the log says what was compensated.
 */
export type CompleteOutcome = { status: 'queued' | 'already-queued' | 'retrying' | 'failed'; key: EventKey } | { status: 'refused'; reason: string };

export interface Automation {
  config: AutomationConfig;
  store: AutomationStore;
  /** Accepts a raw trigger body. Redelivery of a known case is a no-op. */
  handle(raw: unknown): Promise<HandleOutcome>;
  /** Retries every received case that has not been dispatched, then flushes the outbox. Run on start. */
  reconcile(): Promise<void>;
  /** Queues the settled worker's result as the case's single thread reply and flushes the outbox. */
  complete(runId: RunId, result: string | WorkerResult): Promise<CompleteOutcome>;
  flush(): Promise<void>;
  /** Dispatched runs whose case has no `completed` entry in the event log, oldest first. Derived from the log alone. */
  pendingRuns(): RunId[];
}

type CaseState = { phase: 'unknown' } | { phase: 'received'; entry: Extract<LogEntry, { kind: 'received' }> } | { phase: 'dispatched'; entry: Extract<LogEntry, { kind: 'received' }>; runId: RunId };

function caseState(log: LogEntry[], key: EventKey): CaseState {
  let state: CaseState = { phase: 'unknown' };
  for (const entry of log) {
    if (entry.kind === 'received' && entry.key === key && state.phase === 'unknown') state = { phase: 'received', entry };
    if (entry.kind === 'dispatched' && entry.key === key && state.phase === 'received') state = { phase: 'dispatched', entry: state.entry, runId: entry.runId };
  }
  return state;
}

/** Exactly one marker, on the last nonempty line. Anything else is not a verdict this automation may post. */
function markerProblem(result: string, markers: readonly string[]): string | undefined {
  const count = markers.reduce((total, marker) => total + result.split(marker).length - 1, 0);
  if (count !== 1) return `expected exactly one marker, found ${count}`;
  const last = result.trimEnd().split('\n').at(-1)?.trim() ?? '';
  return markers.some((marker) => last.startsWith(marker)) ? undefined : 'marker is not on the last line';
}

const gitHead = (cwd: string) => () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();

export function createAutomation(config: AutomationConfig, deps: AutomationDeps): Automation {
  if (!isIdentifier(config.name)) throw new Error(`invalid automation name: ${config.name}`);
  const store = automationStore(config.projectRoot, config.name);
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();
  const inputCommit = deps.inputCommit ?? gitHead(config.projectRoot);
  const spawnWorker = deps.spawnWorker ?? spawnInTmux(config.projectRoot);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };

  const advance = async (key: EventKey): Promise<HandleOutcome> => {
    const state = caseState(readLog(store), key);
    if (state.phase === 'dispatched') return { status: 'duplicate', key, runId: state.runId };
    if (state.phase === 'unknown') throw new Error(`no received event for ${key}`);
    const { missing, problems } = await missingPrerequisites(config.kind, deps.prerequisites);
    if (missing.length > 0) {
      appendLog(store, { ts: stamp(), kind: 'blocked', key, missing, ...(problems.length > 0 ? { problems } : {}) });
      return { status: 'blocked', key, missing, ...(problems.length > 0 ? { problems } : {}) };
    }
    if (config.kind === 'reproduce') {
      const messages = await deps.destination.readThread(state.entry.event.channel, state.entry.event.rootTs).catch(() => []);
      const marked = messages.filter(message => /\[benny:(bug|performance|other)\]/.test(message.text ?? ''));
      const verdict = marked[0];
      if (!config.triageIdentityUserId || marked.length !== 1 || verdict?.user !== config.triageIdentityUserId || markerProblem(verdict.text ?? '', AUTOMATION_KINDS.triage.replyMarkers!) || !/\[benny:(bug|performance)\]/.test(verdict.text ?? '')) return reject('missing, untrusted or ambiguous triage marker');
    }
    const runId = runIdFor(config.name, key);
    await dispatchRun(config, state.entry.event, runId, { spawnWorker, inputCommit, now });
    appendLog(store, { ts: stamp(), kind: 'dispatched', key, runId });
    return { status: 'dispatched', key, runId };
  };

  /**
   * The reply could not land, so an issue this run created has no announcement and no one to find it. Closing it is the
   * tracker's compensation action, queued like any other and verified by the adapter. A closure that cannot be verified
   * is reported in the run log only, never in the thread.
   */
  const compensate = async (event: AutomationEvent, trackerId: ActionId): Promise<'retrying' | 'done'> => {
    const created = entryOf(trackerId);
    if (created?.state !== 'done' || created.action.kind !== 'tracker' || created.action.operation !== 'create') return 'done';
    const id = actionIdFor(config.name, event.key, 'compensate');
    enqueue(store, { id, kind: 'tracker', operation: 'close', targetId: created.destinationTs, body: '', sourceUrl: sourceUrlOf(event) });
    await flush();
    const closing = entryOf(id);
    if (closing?.state === 'pending') return 'retrying';
    if (!readLog(store).some((entry) => entry.kind === 'compensated' && entry.key === event.key)) {
      appendLog(store, { ts: stamp(), kind: 'compensated', key: event.key, issue: created.destinationTs, verified: closing?.state === 'done', ...(closing?.state === 'failed' ? { reason: closing.reason } : {}) });
    }
    return 'done';
  };

  const reject = (reason: string): HandleOutcome => {
    appendLog(store, { ts: stamp(), kind: 'rejected', reason });
    return { status: 'rejected', reason };
  };

  const lander = deps.tracker === undefined ? undefined : 'land' in deps.tracker ? deps.tracker : directLander(deps.tracker);
  const flush = (options: { ignoreBackoff?: boolean } = {}) => flushOutbox(store, deps.destination, lander, { now, ...options });
  const entryOf = (id: ActionId) => outboxEntries(store).find((entry) => entry.action.id === id);

  return {
    config,
    store,
    handle: (raw) =>
      serial(async () => {
        const parsed = parseEvent(raw);
        if (!parsed.ok) return reject(parsed.reason);
        const { event } = parsed;
        if (event.channel !== config.sourceChannelId) return reject('event is not from the configured source channel');
        if (caseState(readLog(store), event.key).phase === 'unknown') appendLog(store, { ts: stamp(), kind: 'received', key: event.key, event });
        return advance(event.key);
      }),
    reconcile: () =>
      serial(async () => {
        const log = readLog(store);
        const keys = new Set(log.flatMap((entry) => (entry.kind === 'received' ? [entry.key] : [])));
        for (const key of keys) await advance(key);
        await flush({ ignoreBackoff: true });
      }),
    complete: (runId, result) =>
      serial(async (): Promise<CompleteOutcome> => {
        const text = typeof result === 'string' ? result : result.text;
        const intent = typeof result === 'string' ? undefined : result.tracker;
        const log = readLog(store);
        const dispatched = log.find((entry): entry is Extract<LogEntry, { kind: 'dispatched' }> => entry.kind === 'dispatched' && entry.runId === runId);
        if (dispatched === undefined) return { status: 'refused', reason: `no dispatched case for run ${runId}` };
        const state = caseState(log, dispatched.key);
        if (state.phase !== 'dispatched') throw new Error(`event log has a dispatch for ${dispatched.key} without its receipt`);
        const markers = AUTOMATION_KINDS[config.kind].replyMarkers;
        const problem = markers === null ? undefined : markerProblem(text, markers);
        if (problem !== undefined) {
          appendLog(store, { ts: stamp(), kind: 'reply-refused', key: dispatched.key, reason: problem });
          return { status: 'refused', reason: problem };
        }
        const { event } = state.entry;
        const trackerId = actionIdFor(config.name, event.key, 'tracker');
        let failure: string | undefined;
        if (intent !== undefined || entryOf(trackerId) !== undefined) {
          // An action already queued passed the policy before a crash. Asking again would see its own issue as a duplicate.
          if (entryOf(trackerId) === undefined && intent !== undefined) {
            const policy = await deps.trackerPolicy?.(event, intent, text);
            if (config.kind !== 'triage' || !deps.tracker || !policy || !eligibleTrackerAction(intent, policy)) return { status: 'refused', reason: 'ineligible tracker action' };
            const classification = classificationOf(text);
            const labels = intent.operation === 'create' && config.tracker !== undefined && classification !== 'other' ? [config.tracker.labels[classification], config.tracker.labels.intake] : undefined;
            enqueue(store, { ...intent, id: trackerId, kind: 'tracker', sourceUrl: sourceUrlOf(event), ...(labels === undefined ? {} : { labels }) });
          }
          await flush();
          const landed = entryOf(trackerId);
          if (landed?.state === 'pending') return { status: 'retrying', key: event.key };
          if (landed?.state === 'failed') failure = `the tracker write failed after ${landed.attempts} attempts: ${landed.reason}`;
        }
        const replyId = actionIdFor(config.name, event.key, 'result');
        const queued = enqueue(store, { id: replyId, kind: 'thread-reply', channel: event.channel, threadTs: event.rootTs, text: failure === undefined ? text : failureReply(config.kind, failure) });
        await flush();
        const reply = entryOf(replyId);
        if (reply?.state === 'pending') return { status: 'retrying', key: event.key };
        if (reply?.state === 'failed' && (await compensate(event, trackerId)) === 'retrying') return { status: 'retrying', key: event.key };
        if (!readLog(store).some((entry) => entry.kind === 'completed' && entry.runId === runId)) appendLog(store, { ts: stamp(), kind: 'completed', key: event.key, runId });
        return { status: reply?.state === 'failed' ? 'failed' : queued ? 'queued' : 'already-queued', key: event.key };
      }),
    flush: () => serial(flush),
    pendingRuns: () => {
      const log = readLog(store);
      const completed = new Set(log.flatMap((entry) => (entry.kind === 'completed' ? [entry.runId] : [])));
      return log.flatMap((entry) => (entry.kind === 'dispatched' && !completed.has(entry.runId) ? [entry.runId] : []));
    },
  };
}

export type EventSource = { kind: 'webhook'; credentialFile: string; port?: number; maxBodyBytes?: number } | { kind: 'slack-poll'; api: SlackApi; intervalMs: number };

export interface RunningSource {
  url?: string;
  stop(): Promise<void>;
}

const httpStatus: Record<HandleOutcome['status'], number> = { rejected: 422, blocked: 202, dispatched: 200, duplicate: 200 };

/**
 * Starts the automation's one event source after reconciling leftovers. The source lock refuses a second receiver or
 * poller for the same automation, in this process or another.
 */
export async function startEventSource(automation: Automation, source: EventSource): Promise<RunningSource> {
  const release = acquireSourceLock(automation.store, source.kind);
  try {
    await automation.reconcile();
    if (source.kind === 'webhook') {
      const receiver = await startWebhookReceiver({
        credentialFile: source.credentialFile,
        ...(source.port === undefined ? {} : { port: source.port }),
        ...(source.maxBodyBytes === undefined ? {} : { maxBodyBytes: source.maxBodyBytes }),
        onEvent: async (body) => {
          const outcome = await automation.handle(body);
          return { status: httpStatus[outcome.status], body: outcome };
        },
      });
      return {
        url: receiver.url,
        stop: async () => {
          await receiver.close();
          release();
        },
      };
    }
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const loop = async (): Promise<void> => {
      await pollSlackOnce(
        source.api,
        automation.config.sourceChannelId,
        automation.store,
        (raw) => automation.handle(raw),
        () => new Date(),
      ).catch((error: unknown) => appendLog(automation.store, { ts: new Date().toISOString(), kind: 'source-error', reason: error instanceof Error ? error.message : String(error) }));
      if (stopped) return;
      timer = setTimeout(() => {
        running = loop();
      }, source.intervalMs);
      timer.unref();
    };
    let running = loop();
    return {
      stop: async () => {
        stopped = true;
        clearTimeout(timer);
        await running;
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
