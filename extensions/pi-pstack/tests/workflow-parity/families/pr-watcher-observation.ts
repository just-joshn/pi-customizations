import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { processStartTime } from '../../../src/run-files.ts';
import { assignmentOf, skillRequest } from '../lib/checks.ts';
import type { Ctx, RunSpec } from '../lib/driver.ts';
import { type Json, loadRun, type RunView } from '../lib/view.ts';

export const REPEAT_REQUEST = '/poteto-mode babysit PR 16 and get it green';
export const observationsPath = (sandbox: string): string => join(sandbox, 'single-watcher-observations.json');
export const releasePath = (sandbox: string): string => join(sandbox, 'single-watcher-repeat-delivered');

export interface WatcherObservation {
  runId: string;
  id: string;
  instance: string | null;
  phase: string | null;
  childPid: number | null;
  childStarted: string | null;
  before: string | null;
  after: string | null;
  absentBefore?: boolean;
  absentAfter?: boolean;
}
interface Observations {
  deliveries: { message: string; workers: WatcherObservation[] }[];
  spawns: WatcherObservation[][];
}

const matchingProcess = (worker: WatcherObservation): boolean =>
  typeof worker.childPid === 'number' && typeof worker.childStarted === 'string' && worker.childStarted !== '' && worker.before === worker.childStarted && worker.after === worker.childStarted;
export const liveObservation = (worker: WatcherObservation): boolean => worker.phase === 'running' && typeof worker.instance === 'string' && matchingProcess(worker);
const endedObservation = (worker: WatcherObservation): boolean => {
  if (!['exited', 'aborted'].includes(worker.phase ?? '') || typeof worker.childPid !== 'number' || typeof worker.childStarted !== 'string' || worker.childStarted === '') return false;
  const goneAt = (started: string | null, absent: boolean | undefined): boolean => (started === null ? absent === true : started !== '' && started !== worker.childStarted);
  return goneAt(worker.before, worker.absentBefore) && goneAt(worker.after, worker.absentAfter);
};

function processSample(pid: number): { started: string | null; absent: boolean } {
  const started = processStartTime(pid) ?? null;
  let absent = false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    absent = (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
  return { started, absent };
}
const textOf = (message: Json): string =>
  typeof message['content'] === 'string'
    ? message['content']
    : ((message['content'] as Json[]) ?? [])
        .filter((part) => part['type'] === 'text')
        .map((part) => part['text'])
        .join('\n');
const requestText = (text: string): string =>
  skillRequest(text)
    .replace(/^\/poteto-mode\s+/, '')
    .trim();
const requested = (message: Json): boolean => message['role'] === 'user' && requestText(textOf(message)) === requestText(REPEAT_REQUEST);

function observe(ctx: Ctx): WatcherObservation[] {
  const root = join(ctx.repo, '.pi', 'pstack', 'runs');
  if (!existsSync(root)) return [];
  const workers = readdirSync(root)
    .flatMap((id) => loadRun(ctx.repo, id).workers.map((worker) => ({ worker, runId: id })))
    .filter(({ worker }) => {
      const assignment = assignmentOf(worker);
      const argv = assignment.watch?.argv ?? [];
      return assignment.kind === 'watch' && argv[argv.indexOf('--pr') + 1] === '16';
    });
  const observations = workers.map(({ worker, runId }) => {
    const state = worker.state ?? {};
    const supervision = state['supervision'] as Json | undefined;
    const pid = state['childPid'];
    const before = typeof pid === 'number' ? processSample(pid) : { started: null, absent: false };
    return {
      runId,
      id: worker.id,
      instance: typeof state['instance'] === 'string' ? state['instance'] : null,
      phase: typeof state['phase'] === 'string' ? state['phase'] : null,
      childPid: typeof pid === 'number' ? pid : null,
      childStarted: typeof supervision?.['childStarted'] === 'string' ? supervision['childStarted'] : null,
      before: before.started,
      absentBefore: before.absent,
      after: null,
    };
  });
  // Two identity sweeps bracket a common observation interval; a host heartbeat is not child evidence.
  return observations.map((worker) => {
    const after = typeof worker.childPid === 'number' ? processSample(worker.childPid) : { started: null, absent: false };
    return { ...worker, after: after.started, absentAfter: after.absent };
  });
}

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const validObservation = (value: unknown): value is WatcherObservation =>
  isRecord(value) &&
  typeof value['runId'] === 'string' &&
  typeof value['id'] === 'string' &&
  ['instance', 'phase', 'childStarted', 'before', 'after'].every((key) => value[key] === null || typeof value[key] === 'string') &&
  ['absentBefore', 'absentAfter'].every((key) => value[key] === undefined || typeof value[key] === 'boolean') &&
  (value['childPid'] === null || (typeof value['childPid'] === 'number' && Number.isSafeInteger(value['childPid']) && value['childPid'] > 0));
const validWorkers = (value: unknown): value is WatcherObservation[] => Array.isArray(value) && value.every(validObservation);

export function readObservations(sandbox: string): Observations | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(observationsPath(sandbox), 'utf8'));
    if (
      !isRecord(value) ||
      !Array.isArray(value['deliveries']) ||
      !Array.isArray(value['spawns']) ||
      !value['deliveries'].every((delivery: unknown) => isRecord(delivery) && typeof delivery['message'] === 'string' && validWorkers(delivery['workers'])) ||
      !value['spawns'].every(validWorkers)
    )
      return undefined;
    return value as unknown as Observations;
  } catch {
    return undefined;
  }
}

export const observeSingleWatcher: NonNullable<RunSpec['observeEvent']> = (ctx, event, events) => {
  const delivery = event.type === 'message_start' && requested(event['message'] as Json) && events.filter((entry) => entry.type === 'message_start' && requested(entry['message'] as Json)).length === 2;
  const spawn =
    event.type === 'tool_execution_end' &&
    event['toolName'] === 'pstack_worker' &&
    event['isError'] !== true &&
    events.some((entry) => entry.type === 'tool_execution_start' && entry['toolCallId'] === event['toolCallId'] && (entry['args'] as Json)?.['action'] === 'spawn');
  if (!delivery && !spawn) return;
  const evidence = readObservations(ctx.sandbox) ?? { deliveries: [], spawns: [] };
  const workers = observe(ctx);
  if (spawn) evidence.spawns.push(workers);
  if (delivery) evidence.deliveries.push({ message: textOf(event['message'] as Json), workers });
  writeFileSync(observationsPath(ctx.sandbox), JSON.stringify(evidence, null, 2));
  if (delivery) writeFileSync(releasePath(ctx.sandbox), 'repeat request delivered\n');
};

export const repeatOnWatcherSpawn: NonNullable<RunSpec['interrupt']> = (ctx, event) => {
  if (event.type !== 'tool_execution_end' || event['toolName'] !== 'pstack_worker' || event['isError'] === true) return undefined;
  return readObservations(ctx.sandbox)?.spawns.some((workers) => workers.some(liveObservation)) ? REPEAT_REQUEST : undefined;
};

export function repeatPremise(view: RunView): { worker: WatcherObservation } | { inconclusive: string } | { ok: false; evidence: string } {
  const evidence = readObservations(view.sandbox);
  if (evidence === undefined) return { inconclusive: 'no delivery-time watcher observations; historical liveness cannot be inferred from final state or event indexes' };
  if ([...evidence.spawns, ...evidence.deliveries.map((delivery) => delivery.workers)].some((workers) => new Set(workers.filter(matchingProcess).map((worker) => `${worker.childPid}/${worker.childStarted}`)).size > 1))
    return { ok: false, evidence: 'observed overlapping live PR 16 watcher children with matching PID/start identities' };
  const repeat = view.parent.messages.filter((message) => message.role === 'user')[1];
  const delivery = evidence.deliveries[0];
  if (evidence.deliveries.length !== 1 || repeat === undefined || requestText(delivery?.message ?? '') !== requestText(repeat.text)) return { inconclusive: 'the repeat-request delivery is missing or ambiguous' };
  const live = delivery?.workers.filter(liveObservation) ?? [];
  const worker = live[0];
  if (live.length !== 1 || worker === undefined) return { inconclusive: 'the original watcher was not proved live at repeat-request delivery' };
  const original = view.runs.find((run) => run.id === worker.runId)?.workers.find((entry) => entry.id === worker.id);
  const secondOrder = repeat.order;
  const spawned = view.parent.toolCalls.find(
    (call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && original !== undefined && typeof original.dir === 'string' && call.args['assignmentPath'] === join(original.dir, 'assignment.json'),
  );
  if (original === undefined || (spawned !== undefined && spawned.order >= secondOrder)) return { inconclusive: 'delivery observation does not identify an original watcher' };
  const candidates = view.runs
    .flatMap((run) => run.workers.map((entry) => ({ entry, runId: run.id })))
    .filter(({ entry }) => {
      const assignment = assignmentOf(entry);
      const argv = assignment.watch?.argv ?? [];
      return assignment.kind === 'watch' && argv[argv.indexOf('--pr') + 1] === '16';
    });
  for (const candidate of candidates) {
    if (candidate.runId === worker.runId && candidate.entry.id === worker.id) continue;
    const endedThenReplaced = evidence.spawns.some(
      (group) =>
        group.some((entry) => entry.runId === candidate.runId && entry.id === candidate.entry.id && liveObservation(entry)) && group.some((entry) => entry.runId === worker.runId && entry.id === worker.id && endedObservation(entry)),
    );
    if (!endedThenReplaced) return { inconclusive: 'an additional watcher has no proved non-overlapping lifetime' };
  }
  return { worker };
}
