// The trusted parent side of a Benny-style automation: one event source feeds an append-only event store, each new
// case gets one tmux worker with no posting capability, and the parent alone performs external posts through an outbox
// it reconciles against the destination.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { type DispatchConfig, dispatchRun, workerDir, missingPrerequisites, type SpawnWorker, spawnInTmux } from '../src/automation/dispatch.ts';
import { type ActionId, AUTOMATION_KINDS, classificationOf, eligibleTrackerAction, failureReply, trackerUrlOf, withTrackerAttribute, type OpsEditAction, type OpsStatus, opsText, sourceUrlOf, untrustedText, type TrackerConfig, type TrackerEligibility, type TrackerIntent, type WorkerResult, type AutomationEvent, actionIdFor, type EventKey, isIdentifier, type Prerequisite, type Probe, parseEvent, type RunId, runIdFor } from '../src/automation/model.ts';
import { latestStatus } from '../src/automation/operations.ts';
import { directLander, enqueue, flushOutbox, type OperationsDestination, type ThreadDestination, type TrackerDestination, type TrackerLander } from '../src/automation/outbox.ts';
import { pollSlackOnce, type SlackApi } from '../src/automation/slack.ts';
import { type AutomationStore, acquireSourceLock, appendLog, automationStore, type LogEntry, outboxEntries, readLog } from '../src/automation/store.ts';
import { type Download, fetchAttachments } from '../src/automation/attachments.ts';
import { abortRun, type AbortRun } from '../src/automation/abort.ts';
import { createFollowUps } from '../src/automation/follow-up.ts';
import { createReproTurns } from '../src/automation/repro-turns.ts';
import { createRetirement } from '../src/automation/retire.ts';
import { stageEvidence } from '../src/automation/evidence-files.ts';
import { type CollectedRun, collectRun } from '../src/automation/settle.ts';
import { type SteerRun, steerRun } from '../src/automation/steer.ts';
import { startWebhookReceiver } from '../src/automation/webhook.ts';

export { createRoutine, startRoutineSource, type RoutineConfig } from '../src/automation/routine.ts';

export interface AutomationConfig extends DispatchConfig {
  /** The only channel this automation accepts events from. */
  sourceChannelId: string;
  triageIdentityUserId?: string;
  tracker?: TrackerConfig;
  /** The marker line attribute that carries the tracker url (`verdict_markers.tracker_attribute`). */
  trackerAttribute?: string;
  /** The kind's own minutes: triage_total_minutes or repro_minutes, and triage_follow_up_minutes or operations_follow_up_minutes. */
  budgets?: { totalMinutes: number; followUpMinutes: number; /** Repro only: how long to wait for a trusted triage verdict, the window a person may reject the repro in, and the fix phase's own budget. */ verdictWaitMinutes?: number; rejectionWindowMinutes?: number; fixMinutes?: number };
}

export interface AutomationDeps {
  /** Defaults to a tmux worker started as pstack_worker starts one. */
  spawnWorker?: SpawnWorker;
  /** A synchronous tracker the parent writes itself, or a lander that hands each write to a worker. */
  tracker?: TrackerDestination | TrackerLander;
  /** How the parent reads a worker's settled result, stops a worker, and sends an idle one its next message. Default to the runtime's own. */
  collect?: (runId: RunId) => Promise<CollectedRun>;
  abort?: AbortRun;
  steer?: SteerRun;
  /** Fetches a report attachment with the parent's Slack credential. Absent: no attachment is downloaded. */
  downloadAttachment?: Download;
  /** The url of the issue with this id, for a tracker whose urls the parent can build. Another tracker's worker returns its own. */
  trackerUrl?: (id: string) => string | undefined;
  /** Trusted parent reads source and tracker state independently. Never take eligibility from the worker result. */
  trackerPolicy?: (event: AutomationEvent, intent: TrackerIntent, reply: string) => Promise<TrackerEligibility>;
  destination: ThreadDestination;
  /** The operations channel, when `config.operations` names one. Without it the operations status stays in the run log. */
  operations?: OperationsDestination;
  /** A required prerequisite with no probe counts as missing. */
  prerequisites: Partial<Record<Prerequisite, Probe>>;
  inputCommit?: () => string;
  now?: () => Date;
}

export type HandleOutcome =
  | { status: 'rejected'; reason: string }
  | { status: 'blocked'; key: EventKey; missing: Prerequisite[]; problems?: string[] }
  /** Repro only: no triage verdict is in the thread yet, and verdict_wait_minutes has not passed. Nothing was posted or started. */
  | { status: 'waiting'; key: EventKey }
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
  /** Moves each open follow-up window one step: closes an ended one, collects a settled round, starts a round for new human messages. */
  advanceFollowUps(): Promise<void>;
  /** Repro only: looks again at each case still waiting for its triage verdict. Dispatches it, closes it, or lets it wait. */
  retryWaiting(): Promise<void>;
  /** Repro only: holds the rejection window after the first report, and sends the worker its review and fix turns. */
  advanceRepro(): Promise<void>;
  /** Shuts down the idle worker of each case whose lifecycle is over, once. */
  retireWorkers(): Promise<void>;
  /** Brings the operations status message in line with what each pending repro run last reported, then retries every pending outbox action. */
  syncOperations(): Promise<void>;
  /** When the run was dispatched, from the event log. */
  dispatchedAt(runId: RunId): Date | undefined;
  /** The clock this automation uses. */
  now(): Date;
  /** Dispatched runs whose case has no `completed` entry in the event log, oldest first. Derived from the log alone. */
  pendingRuns(): RunId[];
}

type CaseState = { phase: 'unknown' } | { phase: 'received'; entry: Extract<LogEntry, { kind: 'received' }> } | { phase: 'closed'; reason: string } | { phase: 'dispatched'; entry: Extract<LogEntry, { kind: 'received' }>; runId: RunId };

function caseState(log: LogEntry[], key: EventKey): CaseState {
  let state: CaseState = { phase: 'unknown' };
  for (const entry of log) {
    if (entry.kind === 'received' && entry.key === key && state.phase === 'unknown') state = { phase: 'received', entry };
    if (entry.kind === 'dispatched' && entry.key === key && state.phase === 'received') state = { phase: 'dispatched', entry: state.entry, runId: entry.runId };
    if (entry.kind === 'rejected' && entry.key === key && state.phase === 'received') state = { phase: 'closed', reason: entry.reason };
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

type TriageVerdict = { kind: 'none' } | { kind: 'refused'; reason: string } | { kind: 'trusted'; trackerUrl?: string };

/**
 * What the repro automation may act on: exactly one message in the thread carries a marker, it comes from the configured
 * triage identity, its last line is that one marker, and the marker is bug or performance. No marker at all is not a
 * refusal, because the verdict may not have been posted yet.
 */
function triageVerdict(thread: readonly { user?: string; text?: string }[], triageIdentityUserId: string | undefined, attribute: string): TriageVerdict {
  const marked = thread.filter((message) => /\[benny:(bug|performance|other)\]/.test(message.text ?? ''));
  if (marked.length === 0) return { kind: 'none' };
  const verdict = marked[0];
  const text = verdict?.text ?? '';
  if (!triageIdentityUserId || marked.length !== 1 || verdict?.user !== triageIdentityUserId || markerProblem(text, AUTOMATION_KINDS.triage.replyMarkers!) || !/\[benny:(bug|performance)\]/.test(text)) return { kind: 'refused', reason: 'missing, untrusted or ambiguous triage marker' };
  const trackerUrl = trackerUrlOf(text, attribute);
  return { kind: 'trusted', ...(trackerUrl === undefined ? {} : { trackerUrl }) };
}

const gitHead = (cwd: string) => () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();

export function createAutomation(config: AutomationConfig, deps: AutomationDeps): Automation {
  if (!isIdentifier(config.name)) throw new Error(`invalid automation name: ${config.name}`);
  const store = automationStore(config.projectRoot, config.name);
  const now = deps.now ?? (() => new Date());
  const trackerAttribute = config.trackerAttribute ?? 'tracker';
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
    if (state.phase === 'closed') return { status: 'rejected', reason: state.reason };
    if (state.phase === 'unknown') throw new Error(`no received event for ${key}`);
    const { event } = state.entry;
    const readThread = () => deps.destination.readThread(event.channel, event.rootTs).catch(() => []);
    // Repro waits for the triage verdict before anything else: it costs one Slack read, and a case with no verdict yet has no use for the probes.
    let thread: Awaited<ReturnType<typeof readThread>> | undefined;
    let trackerUrl: string | undefined;
    if (config.kind === 'reproduce') {
      thread = await readThread();
      const verdict = triageVerdict(thread, config.triageIdentityUserId, trackerAttribute);
      if (verdict.kind === 'none') {
        const waitMinutes = config.budgets?.verdictWaitMinutes ?? 0;
        if (now().getTime() - Date.parse(state.entry.ts) < waitMinutes * 60_000) {
          if (!readLog(store).some((entry) => entry.kind === 'awaiting-verdict' && entry.key === key)) appendLog(store, { ts: stamp(), kind: 'awaiting-verdict', key });
          return { status: 'waiting', key };
        }
        return reject(`no trusted triage verdict within ${waitMinutes} minutes`, key);
      }
      if (verdict.kind === 'refused') return reject(verdict.reason, key);
      trackerUrl = verdict.trackerUrl;
    }
    const { missing, problems } = await missingPrerequisites(config.kind, deps.prerequisites);
    if (missing.length > 0) {
      appendLog(store, { ts: stamp(), kind: 'blocked', key, missing, ...(problems.length > 0 ? { problems } : {}) });
      return { status: 'blocked', key, missing, ...(problems.length > 0 ? { problems } : {}) };
    }
    thread ??= await readThread();
    const runId = runIdFor(config.name, key);
    const { files } = event;
    const attachments = deps.downloadAttachment === undefined || files.length === 0 ? undefined : await fetchAttachments(join(workerDir(config.projectRoot, runId), 'attachments'), files, deps.downloadAttachment);
    const { rejectionWindowMinutes, fixMinutes } = config.budgets ?? {};
    const phases = config.kind === 'reproduce' && rejectionWindowMinutes !== undefined ? { windowMinutes: rejectionWindowMinutes, ...(fixMinutes === undefined ? {} : { fixMinutes }) } : undefined;
    await dispatchRun(config, event, runId, { spawnWorker, inputCommit, now, thread, ...(trackerUrl === undefined ? {} : { trackerUrl }), ...(attachments === undefined ? {} : { attachments }), ...(phases === undefined ? {} : { phases }) });
    appendLog(store, { ts: stamp(), kind: 'dispatched', key, runId });
    return { status: 'dispatched', key, runId };
  };

  /**
   * Makes the operations root show `status`: it queues the root on first use and one edit per change after that. Every
   * action id is derived from the case and a counter, so a repeat after a crash finds what it queued and adds nothing.
   */
  const showStatus = (event: AutomationEvent, status: OpsStatus, note?: string) => {
    if (operations === undefined) return;
    const text = opsText(operations, status, sourceUrlOf(event), note);
    const rootId = actionIdFor(config.name, event.key, 'ops-root');
    const root = entryOf(rootId);
    if (root?.state === 'failed') return;
    if (root === undefined) {
      enqueue(store, { id: rootId, kind: 'ops-root', channel: operations.channelId, text });
      return;
    }
    let shown = root.action.kind === 'ops-root' ? root.action.text : '';
    let edits = 0;
    for (let edit = entryOf(actionIdFor(config.name, event.key, 'ops-edit-1')); edit !== undefined; edit = entryOf(actionIdFor(config.name, event.key, `ops-edit-${edits + 1}`))) {
      edits += 1;
      shown = (edit.action as OpsEditAction).text;
    }
    if (shown !== text) enqueue(store, { id: actionIdFor(config.name, event.key, `ops-edit-${edits + 1}`), kind: 'ops-edit', channel: operations.channelId, rootId, text });
  };

  const eventOf = (runId: RunId): AutomationEvent | undefined => {
    const log = readLog(store);
    const dispatched = log.find((entry): entry is Extract<LogEntry, { kind: 'dispatched' }> => entry.kind === 'dispatched' && entry.runId === runId);
    const state = dispatched === undefined ? undefined : caseState(log, dispatched.key);
    return state?.phase === 'dispatched' ? state.entry.event : undefined;
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

  const reject = (reason: string, key?: EventKey): HandleOutcome => {
    appendLog(store, { ts: stamp(), kind: 'rejected', reason, ...(key === undefined ? {} : { key }) });
    return { status: 'rejected', reason };
  };

  const lander = deps.tracker === undefined ? undefined : 'land' in deps.tracker ? deps.tracker : directLander(deps.tracker);
  const operations = config.kind === 'reproduce' && config.operations !== undefined && deps.operations !== undefined ? config.operations : undefined;
  const flush = (options: { ignoreBackoff?: boolean } = {}) => flushOutbox(store, deps.destination, lander, { now, sourceChannel: config.sourceChannelId, ...(deps.operations === undefined ? {} : { operations: deps.operations }), ...options });
  /** A turn's status on the operations message and its reply in the operations thread. False while one of them is still to land. */
  const reportTurn = async (event: AutomationEvent, _runId: RunId, result: { status?: OpsStatus; operations?: string; text?: string; evidence?: string[] }, replyKey: string): Promise<boolean> => {
    // A rerun that confirms a repro may post the one source reply upstream allows, when the first report left none.
    const source = result.status === 'Reproduced' && result.text !== undefined ? result.text.trim() : '';
    if (source !== '') {
      const id = actionIdFor(config.name, event.key, 'result');
      enqueue(store, { id, kind: 'thread-reply', channel: event.channel, threadTs: event.rootTs, ...withEvidence(event, _runId, id, source, result.evidence) });
      await flush();
      if (entryOf(id)?.state === 'pending') return false;
    }
    if (operations === undefined) return true;
    if (result.status !== undefined) showStatus(event, result.status);
    await flush();
    const root = entryOf(actionIdFor(config.name, event.key, 'ops-root'));
    if (root?.state === 'pending') return false;
    const reply = result.operations === undefined ? '' : untrustedText(result.operations).trim();
    if (root?.state !== 'done' || reply === '') return true;
    const id = actionIdFor(config.name, event.key, `ops-reply-${replyKey}`);
    enqueue(store, { id, kind: 'thread-reply', channel: operations.channelId, threadTs: root.destinationTs, text: reply });
    await flush();
    return entryOf(id)?.state !== 'pending';
  };
  const reproTurns = createReproTurns({ config, store, destination: deps.destination, now, collect: deps.collect ?? ((runId) => collectRun(config.projectRoot, runId)), abort: deps.abort ?? abortRun, steer: (runId, text) => (deps.steer ?? steerRun)(config.projectRoot, runId, text), report: reportTurn });
  const reproduce = {
    anchor: (key: EventKey) => reproTurns.followUpAnchor(key),
    outcome: (key: EventKey) => {
      const outcome = readLog(store).find((entry): entry is Extract<LogEntry, { kind: 'repro-outcome' }> => entry.kind === 'repro-outcome' && entry.key === key);
      return { ...(outcome?.status === undefined ? {} : { status: outcome.status }), ...(outcome?.note === undefined ? {} : { note: outcome.note }) };
    },
    rerun: (key: EventKey, correction: string) => reproTurns.startRerun(key, correction),
  };
  const followUps = createFollowUps({ config, store, destination: deps.destination, spawnWorker, now, flush: () => flush(), ...(deps.collect === undefined ? {} : { collect: deps.collect }), ...(deps.abort === undefined ? {} : { abort: deps.abort }), reproduce });
  const retirement = createRetirement({ config, store, now, abort: deps.abort ?? abortRun, anchor: (key, completedTs) => (config.kind === 'reproduce' ? reproTurns.followUpAnchor(key) : completedTs), inFlight: () => reproTurns.inFlightRuns() });
  const pendingRuns = (): RunId[] => {
    const log = readLog(store);
    const completed = new Set(log.flatMap((entry) => (entry.kind === 'completed' ? [entry.runId] : [])));
    return log.flatMap((entry) => (entry.kind === 'dispatched' && !completed.has(entry.runId) ? [entry.runId] : []));
  };
  const entryOf = (id: ActionId) => outboxEntries(store).find((entry) => entry.action.id === id);
  /**
   * The source reply with the evidence the worker asked to attach, so far as upstream allows it (vendor reproduce SKILL.md:214).
   * Files the parent may not attach are named in the log, and the reply then links the operations thread, where the
   * evidence is. A reply never waits on its files.
   */
  const withEvidence = (event: AutomationEvent, runId: RunId, replyId: ActionId, text: string, requested: readonly string[] | undefined): { text: string; attachments?: { path: string; name: string; mimetype: string }[]; textWithoutAttachments?: string } => {
    if (config.kind !== 'reproduce' || requested === undefined || requested.length === 0 || text.trim() === '' || entryOf(replyId) !== undefined) return { text };
    const staged = stageEvidence({ requested, artifactDirectory: config.artifactDirectory, retentionHours: config.artifactRetentionHours, runId, now: now(), into: join(store.dir, 'evidence', replyId) });
    appendLog(store, { ts: stamp(), kind: 'evidence-staged', key: event.key, runId, attached: staged.files.length, skipped: staged.skipped });
    const root = entryOf(actionIdFor(config.name, event.key, 'ops-root'));
    const linked = root?.state === 'done' && operations !== undefined ? `${text}\nEvidence: https://slack.com/archives/${operations.channelId}/p${root.destinationTs.replace('.', '')}` : text;
    if (staged.files.length === 0) return { text: linked };
    return { text: staged.skipped.length > 0 ? linked : text, attachments: staged.files, textWithoutAttachments: linked };
  };
  /** The link to the issue the case's tracker action wrote or updated, once it landed. */
  const issueUrlOf = (id: ActionId): string | undefined => {
    const entry = entryOf(id);
    if (entry?.state !== 'done' || entry.action.kind !== 'tracker' || entry.action.operation === 'close') return undefined;
    const issue = entry.action.operation === 'create' ? entry.destinationTs : entry.action.targetId;
    return entry.url ?? (issue === undefined ? undefined : deps.trackerUrl?.(issue));
  };

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
        const status = typeof result === 'string' ? undefined : result.status;
        const operationsReply = typeof result === 'string' ? undefined : result.operations;
        if (config.kind === 'reproduce') appendLog(store, { ts: stamp(), kind: 'repro-outcome', key: event.key, runId, ...(status === undefined ? {} : { status }), ...(operationsReply === undefined ? {} : { note: operationsReply.slice(0, 500) }) });
        if (operations !== undefined) {
          // Upstream updates the operations status first. A root that cannot land holds the source reply only until its retry limit.
          showStatus(event, status ?? latestStatus(config.projectRoot, runId)?.status ?? 'Reproducing');
          await flush();
          const rootId = actionIdFor(config.name, event.key, 'ops-root');
          const root = entryOf(rootId);
          if (root?.state === 'done' && operationsReply !== undefined && untrustedText(operationsReply).trim() !== '') {
            enqueue(store, { id: actionIdFor(config.name, event.key, 'ops-reply'), kind: 'thread-reply', channel: operations.channelId, threadTs: root.destinationTs, text: untrustedText(operationsReply).trim() });
            await flush();
          }
          if (root?.state === 'pending') return { status: 'retrying', key: event.key };
        }
        const replyId = actionIdFor(config.name, event.key, 'result');
        const replyText = failure !== undefined ? failureReply(config.kind, failure) : markers === null ? text : withTrackerAttribute(text, trackerAttribute, issueUrlOf(trackerId));
        // A repro run with nothing confirmed posts nothing in the source thread: the operations thread and the run log carry it.
        const queued = replyText.trim() === '' ? false : enqueue(store, { id: replyId, kind: 'thread-reply', channel: event.channel, threadTs: event.rootTs, ...withEvidence(event, runId, replyId, replyText, typeof result === 'string' ? undefined : result.evidence) });
        await flush();
        const reply = entryOf(replyId);
        if (reply?.state === 'pending') return { status: 'retrying', key: event.key };
        // (the reply entry is absent when nothing was queued)
        if (reply?.state === 'failed' && (await compensate(event, trackerId)) === 'retrying') return { status: 'retrying', key: event.key };
        if (!readLog(store).some((entry) => entry.kind === 'completed' && entry.runId === runId)) appendLog(store, { ts: stamp(), kind: 'completed', key: event.key, runId });
        return { status: reply?.state === 'failed' ? 'failed' : queued ? 'queued' : 'already-queued', key: event.key };
      }),
    retryWaiting: () =>
      serial(async () => {
        const log = readLog(store);
        const waiting = new Set(log.flatMap((entry) => (entry.kind === 'awaiting-verdict' ? [entry.key] : [])));
        for (const key of waiting) if (caseState(log, key).phase === 'received') await advance(key);
      }),
    flush: () => serial(flush),
    advanceFollowUps: () => serial(() => followUps.advance()),
    advanceRepro: () => serial(() => reproTurns.advance()),
    retireWorkers: () => serial(() => retirement.advance()),
    syncOperations: () =>
      serial(async () => {
        if (operations !== undefined) {
          for (const runId of [...pendingRuns(), ...reproTurns.inFlightRuns()]) {
            const event = eventOf(runId);
            if (event === undefined) continue;
            const reported = latestStatus(config.projectRoot, runId);
            showStatus(event, reported?.status ?? 'Reproducing', reported?.note);
          }
        }
        await flush();
      }),
    dispatchedAt: (runId) => {
      const entry = readLog(store).find((candidate) => candidate.kind === 'dispatched' && candidate.runId === runId);
      return entry === undefined ? undefined : new Date(entry.ts);
    },
    now,
    pendingRuns,
  };
}

export type EventSource = { kind: 'webhook'; credentialFile: string; port?: number; maxBodyBytes?: number } | { kind: 'slack-poll'; api: SlackApi; intervalMs: number };

export interface RunningSource {
  url?: string;
  stop(): Promise<void>;
}

const httpStatus: Record<HandleOutcome['status'], number> = { rejected: 422, blocked: 202, waiting: 202, dispatched: 200, duplicate: 200 };

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
