// Two obligations upstream puts on a repro run, enforced from what the worker leaves in its worktree and on the forge,
// because a same-uid worker cannot be made unable to run git or `gh` (forge.ts):
//
//  - No fix before the go-ahead (vendor reproduce SKILL.md:216 'Do not start the fix phase until the window closes without a
//    valid rejection', 228-234 'If any condition fails, keep the repro report and stop without a pull request'). Until the
//    parent has sent the fix turn, a commit on the worker's branch (or anywhere its worktree committed), a pushed run
//    branch, or a pull request on it is a fix started early. The outcome is upstream's: the repro report stays, the worker
//    is stopped, and no pull request is left. A pull request found is closed (reopenable, with a comment) and, being the
//    one thing that could be ready for review, made a draft first. The pushed branch is left alone: deleting it is not
//    reversible, and a person can read it.
//
//  - Drafts only (SKILL.md:291, `repository.draft_only`). Whatever else the worker did, every open pull request on its run
//    branch is a draft before the parent moves on, and stays one until the worker is shut down.
//
// Detection of commits is local git and runs every pass. The forge reads are throttled, and every step is derived from
// current state, so a restart repeats nothing it already did.
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

  /** The worker started the fix early: stop it, leave no pull request, and say so. */
  const stop = async (run: Run, seen: { ahead: number; committed: number }): Promise<void> => {
    await host.abort(config.projectRoot, run.runId);
    let pushed: boolean | 'unknown' = 'unknown';
    const urls: string[] = [];
    if (forge.target !== undefined) {
      pushed = await forge.pushed(config.projectRoot, run.runId);
      for (const pr of await forge.pullRequests(run.runId)) {
        if (pr.state !== 'OPEN') continue;
        const { pr: draft } = await forge.ensureDraft(pr);
        await forge.close(draft, 'Closed by the Benny parent: the repro worker started its fix before the rejection window closed, so no pull request is wanted for this case.');
        urls.push(pr.url);
      }
    }
    const commits = (count: number, where: string) => `${count} commit${count === 1 ? '' : 's'} ${where}`;
    const found = [seen.ahead > 0 ? commits(seen.ahead, 'on its run branch') : seen.committed > 0 ? commits(seen.committed, 'in its worktree') : '', pushed === true ? 'a pushed run branch' : '', urls.length > 0 ? `a pull request (${urls.join(', ')})` : ''].filter((part) => part !== '');
    if (run.event !== undefined) {
      const reported = await host.report(run.event, run.runId, { operations: `The repro worker started the fix before the go-ahead (${found.join(', ')}). It was stopped and no fix was attempted: the repro report stands.${urls.length > 0 ? ' The pull request was closed.' : ''}${pushed === true ? ' Its branch was left in place.' : ''}` }, 'unprompted-fix');
      if (!reported) return;
    }
    appendLog(store, { ts: stamp(), kind: 'unprompted-fix', key: run.key, runId: run.runId, ahead: seen.ahead, committed: seen.committed, pushed, pullRequests: urls });
    if (run.completed && !readLog(store).some((entry) => entry.kind === 'repro-closed' && entry.key === run.key)) appendLog(store, { ts: stamp(), kind: 'repro-closed', key: run.key, runId: run.runId, reason: 'the worker started the fix before the go-ahead, so it was stopped and no fix was attempted' });
  };

  return {
    async advance() {
      if (config.kind !== 'reproduce') return;
      for (const run of runs(readLog(store))) {
        if (run.retired || run.stopped) continue;
        try {
          if (!run.goAhead) {
            const seen = await forge.state(config.projectRoot, run.runId);
            if (seen.ahead > 0 || seen.committed > 0) {
              await stop(run, seen);
              continue;
            }
          }
          const due = host.now().getTime() - (lastRead.get(run.runId) ?? 0) >= FORGE_READ_MS;
          if (due) {
            lastRead.set(run.runId, host.now().getTime());
            if (!run.goAhead && forge.target !== undefined) {
              // A run branch or pull request with no local commit still means the worker pushed work early.
              if ((await forge.pushed(config.projectRoot, run.runId)) || (await forge.pullRequests(run.runId)).length > 0) {
                await stop(run, await forge.state(config.projectRoot, run.runId));
                continue;
              }
            }
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
