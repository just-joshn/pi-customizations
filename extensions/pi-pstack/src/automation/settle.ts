// Completion of Benny cases. The event source is a plain Node process, not a Pi session, so no wake message reaches it.
// It learns that a worker settled by reading the worker's host state, the same state `pstack_worker collect` reads,
// and which runs still owe a reply comes from the event log alone, so a restart never completes a run twice.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Automation } from '../../adapters/automation-events.ts';
import { hostTarget, inspectHost } from '../rpc-client.ts';
import { type HostState, isTerminal, loadAssignment, readHostState } from '../run-files.ts';
import { workerDir } from './dispatch.ts';
import { failureReply, type RunId, type TrackerIntent, type WorkerResult } from './model.ts';
import { appendLog } from './store.ts';

export type CollectedRun = { settled: false } | { settled: true; failure: string | null; finalText: string | null };

/** Mirrors the final-text read of the `collect` action in src/workers.ts, which does not export it. */
function finalAssistantText(sessionFile: string | null): string | null {
  if (sessionFile === null || !existsSync(sessionFile)) return null;
  let text: string | null = null;
  for (const line of readFileSync(sessionFile, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
    if (entry.type !== 'message' || entry.message?.role !== 'assistant') continue;
    const content = entry.message.content;
    const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.flatMap((part: { type?: string; text?: string }) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])) : [];
    if (parts.length > 0) text = parts.join('');
  }
  return text;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Settled means what `collect` means: the latest settle covers the latest work generation, on an idle or ended host.
 * A host that ended or died holding work no settle covers will never settle, so that is a failure, not a wait.
 */
export async function collectRun(projectRoot: string, runId: RunId, inspect: typeof inspectHost = inspectHost): Promise<CollectedRun> {
  const loaded = loadAssignment(join(workerDir(projectRoot, runId), 'assignment.json'));
  let live: HostState | undefined;
  try {
    live = await inspect(hostTarget(loaded));
  } catch {}
  const state = live ?? readHostState(loaded.workerDir);
  if (state === undefined) return { settled: false };
  const last = state.settles.at(-1);
  if (last === undefined || last.generation !== state.generation || !(isTerminal(state.phase) || state.phase === 'idle')) {
    const gone = live === undefined && (isTerminal(state.phase) || !alive(state.hostPid));
    return gone ? { settled: true, failure: `the worker host ended in phase ${state.phase} without finishing its work`, finalText: null } : { settled: false };
  }
  if (last.phase === 'failed' || last.phase === 'aborted' || last.phase === 'exited') return { settled: true, failure: `the worker ${last.phase}${last.reason === null ? '' : `: ${oneLine(last.reason)}`}`, finalText: null };
  const finalText = finalAssistantText(state.sessionFile);
  if (finalText === null || finalText.trim() === '') return { settled: true, failure: 'the worker produced no final message', finalText: null };
  return { settled: true, failure: null, finalText };
}

const OPERATIONS = ['create', 'update', 'comment'] as const;

function intentOf(value: unknown): TrackerIntent | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const operation = OPERATIONS.find((candidate) => candidate === raw['operation']);
  if (operation === undefined || typeof raw['body'] !== 'string') return undefined;
  return {
    operation,
    body: raw['body'],
    ...(typeof raw['title'] === 'string' ? { title: raw['title'] } : {}),
    ...(typeof raw['targetId'] === 'string' ? { targetId: raw['targetId'] } : {}),
  };
}

/** The brief asks for a JSON object with `text` and an optional `tracker` intent. Anything else is the reply text itself. */
export function parseWorkerResult(finalText: string): string | WorkerResult {
  const body = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(finalText.trim())?.[1] ?? finalText.trim();
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { text?: unknown }).text === 'string') {
      const tracker = intentOf((parsed as { tracker?: unknown }).tracker);
      return { text: (parsed as { text: string }).text, ...(tracker === undefined ? {} : { tracker }) };
    }
  } catch {}
  return finalText;
}

/**
 * Completes every dispatched run that has settled. A tracker request the parent refuses still leaves the worker's
 * verdict to post without it, and a verdict the parent refuses (no single marker) becomes the failure reply.
 */
export async function completeSettledRuns(automation: Automation, collect: (runId: RunId) => Promise<CollectedRun> = (runId) => collectRun(automation.config.projectRoot, runId)): Promise<number> {
  let completed = 0;
  for (const runId of automation.pendingRuns()) {
    const run = await collect(runId);
    if (!run.settled) continue;
    const failure = failureReply(automation.config.kind, run.failure ?? 'its reply was not a verdict this automation may post');
    const result = run.failure === null && run.finalText !== null ? parseWorkerResult(run.finalText) : failure;
    const attempts = typeof result === 'string' ? [result] : [result, result.text];
    for (const attempt of [...attempts, failure]) {
      const outcome = await automation.complete(runId, attempt);
      if (outcome.status === 'retrying') break;
      if (outcome.status !== 'refused') {
        completed += 1;
        break;
      }
    }
  }
  return completed;
}

export function startSettler(automation: Automation, options: { intervalMs: number; collect?: (runId: RunId) => Promise<CollectedRun> }): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async (): Promise<void> => {
    await completeSettledRuns(automation, options.collect).catch((error: unknown) => appendLog(automation.store, { ts: new Date().toISOString(), kind: 'source-error', reason: `settle: ${error instanceof Error ? error.message : String(error)}` }));
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick();
    }, options.intervalMs);
    timer.unref();
  };
  running = tick();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
