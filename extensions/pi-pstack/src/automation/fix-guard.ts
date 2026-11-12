// Drafts only (vendor reproduce SKILL.md:291, `repository.draft_only`), enforced from what the worker leaves on the forge,
// because a same-uid worker cannot be made unable to run `gh` (forge.ts). Whatever else the worker did, every open pull
// request on its run branch is a draft before the parent moves on, and stays one until the worker is shut down. The forge
// reads are throttled, and every step is derived from current state, so a restart repeats nothing it already did.
import type { AutomationConfig } from '../../adapters/automation-events.ts';
import type { AbortRun } from './abort.ts';
import type { Forge } from './forge.ts';
import type { AutomationEvent, EventKey, OpsStatus, RunId } from './model.ts';
import { type AutomationStore, appendLog, type LogEntry, readLog } from './store.ts';

const FORGE_READ_MS = 60_000;

interface Run {
  key: EventKey;
  runId: RunId;
  event: AutomationEvent | undefined;
  goAhead: boolean;
  stopped: boolean;
  retired: boolean;
  completed: boolean;
}

function runs(log: LogEntry[]): Run[] {
  const events = new Map<EventKey, AutomationEvent>();
  const found = new Map<RunId, Run>();
  for (const entry of log) {
    if (entry.kind === 'received') events.set(entry.key, entry.event);
    if (entry.kind === 'dispatched') found.set(entry.runId, { key: entry.key, runId: entry.runId, event: events.get(entry.key), goAhead: false, stopped: false, retired: false, completed: false });
  }
  for (const entry of log) {
    const run = 'runId' in entry ? found.get(entry.runId) : undefined;
    if (run === undefined) continue;
    if (entry.kind === 'repro-turn' && entry.purpose === 'fix') run.goAhead = true;
    if (entry.kind === 'unprompted-fix') run.stopped = true;
    if (entry.kind === 'worker-retired' && entry.ok) run.retired = true;
    if (entry.kind === 'completed') run.completed = true;
  }
  return [...found.values()];
}

export interface FixGuardHost {
  config: AutomationConfig;
  store: AutomationStore;
  now: () => Date;
  forge: Forge;
  abort: AbortRun;
  /** Posts `operations` in the operations thread, once per `replyKey`. False while it is still to land. */
  report: (event: AutomationEvent, runId: RunId, result: { status?: OpsStatus; operations?: string }, replyKey: string) => Promise<boolean>;
}

export function createFixGuard(host: FixGuardHost): { advance(): Promise<void>; sweep(runId: RunId): Promise<void> } {
  const { config, store, forge } = host;
  const stamp = () => host.now().toISOString();
  const lastRead = new Map<RunId, number>();

  /** Open pull requests on the run branch that are not drafts become drafts. The notice is queued before the conversion, so a crash between them still tells the operations thread. */
  const sweepDrafts = async (run: Run): Promise<void> => {
    if (forge.target === undefined) return;
    for (const pr of await forge.pullRequests(run.runId)) {
      if (pr.state !== 'OPEN' || pr.isDraft) continue;
      if (run.event !== undefined && !(await host.report(run.event, run.runId, { operations: `Pull request ${pr.url} was ready for review. Benny opens draft pull requests only, so the parent converted it to a draft.` }, `draft-guard-${pr.number}`))) return;
      await forge.ensureDraft(pr);
      if (!readLog(store).some((entry) => entry.kind === 'draft-guard' && entry.runId === run.runId && entry.pullRequest === pr.url)) appendLog(store, { ts: stamp(), kind: 'draft-guard', key: run.key, runId: run.runId, pullRequest: pr.url });
    }
  };

  return {
    async advance() {
      if (config.kind !== 'reproduce') return;
      for (const run of runs(readLog(store))) {
        if (run.retired || run.stopped) continue;
        try {
          const due = host.now().getTime() - (lastRead.get(run.runId) ?? 0) >= FORGE_READ_MS;
          if (due) {
            lastRead.set(run.runId, host.now().getTime());
            await sweepDrafts(run);
          }
        } catch (error) {
          appendLog(store, { ts: stamp(), kind: 'source-error', reason: `fix guard: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    },
    /** The last look before a worker is shut down: its pull requests are drafts. */
    async sweep(runId) {
      const run = runs(readLog(store)).find((candidate) => candidate.runId === runId);
      if (run !== undefined && config.kind === 'reproduce') await sweepDrafts(run);
    },
  };
}
