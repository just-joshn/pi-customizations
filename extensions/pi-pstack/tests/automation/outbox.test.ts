import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { type Automation, type AutomationConfig, type AutomationDeps, createAutomation } from '../../adapters/automation-events.ts';
import type { RunId, WorkerResult } from '../../src/automation/model.ts';
import { OUTBOX_RETRY_LIMIT, type ThreadDestination } from '../../src/automation/outbox.ts';
import { outboxEntries, readLog } from '../../src/automation/store.ts';

const CHANNEL = 'CSOURCE01';
const EVENT = (ts: string) => ({ source_channel_id: CHANNEL, ts, user: 'U1', text: 'Export is broken' });
const VERDICT = 'Reproducible export failure.\n[benny:bug]';
const CREATE: WorkerResult = { text: VERDICT, tracker: { operation: 'create', title: 'Export is broken', body: 'Expected a file. Observed nothing.' } };

let project: string;
let clock = 0;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'outbox-'));
  mkdirSync(join(project, '.pi'), { recursive: true });
  clock = Date.parse('2026-11-12T08:00:00Z');
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
const advance = (ms: number) => void (clock += ms);

function fixture(options: { trackerFails?: boolean; failPosts?: number } = {}) {
  const posts: { threadTs: string; text: string }[] = [];
  const thread: { ts: string; marker?: string }[] = [];
  let failPosts = options.failPosts ?? 0;
  const tickets: string[] = [];
  const destination: ThreadDestination = {
    readThread: async () => [{ ts: '1762900000.000100' }, { ts: '1762900000.000200' }, ...thread],
    post: async (action) => {
      if (failPosts > 0) {
        failPosts -= 1;
        throw new Error('slack ratelimited');
      }
      posts.push({ threadTs: action.threadTs, text: action.text });
      thread.push({ ts: `1762900001.00000${thread.length}`, marker: action.id });
      return { ts: `1762900001.00000${thread.length - 1}` };
    },
  };
  const spawned: RunId[] = [];
  const config: AutomationConfig = { name: 'benny-triage', kind: 'triage', projectRoot: project, sourceChannelId: CHANNEL, tracker: { type: 'github', labels: { bug: 'bug', performance: 'performance', intake: 'intake', needsRepro: 'needs-repro' } } };
  const deps: AutomationDeps = {
    spawnWorker: async (runId) => void spawned.push(runId),
    destination,
    prerequisites: { tracker: async () => true },
    inputCommit: () => 'a'.repeat(40),
    now: () => new Date(clock),
    tracker: {
      searchByMarker: async () => [],
      create: async (action) => {
        if (options.trackerFails) throw new Error('gh: HTTP 502');
        tickets.push(action.id);
        return { id: '7' };
      },
      update: async () => ({ id: '7' }),
      comment: async () => ({ id: '7' }),
    },
    trackerPolicy: async () => ({ classification: 'bug', clearlyBroken: true, live: true, duplicate: 'none', sourceVerified: true, targetResolved: true, canCompensate: true }),
  };
  const automation: Automation = createAutomation(config, deps);
  return { automation, posts, tickets, config, deps };
}

async function dispatch(automation: Automation, ts: string): Promise<RunId> {
  const outcome = await automation.handle(EVENT(ts));
  if (outcome.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(outcome)}`);
  return outcome.runId;
}

test('a tracker write that keeps failing does not hold the thread reply forever: after the retry limit the failure reply posts', async () => {
  const f = fixture({ trackerFails: true });
  const runId = await dispatch(f.automation, '1762900000.000100');
  for (let attempt = 1; attempt < OUTBOX_RETRY_LIMIT; attempt += 1) {
    expect(await f.automation.complete(runId, CREATE)).toMatchObject({ status: 'retrying' });
    expect(f.posts).toHaveLength(0);
    advance(10 * 60_000);
  }
  expect(await f.automation.complete(runId, CREATE)).toMatchObject({ status: 'queued' });
  expect(f.posts).toHaveLength(1);
  expect(f.posts[0]?.threadTs).toBe('1762900000.000100');
  expect(f.posts[0]?.text).toMatch(/could not finish this report: the tracker write failed after \d+ attempts: gh: HTTP 502\. No ticket was created\.\n\[benny:other\]$/);
  expect(f.automation.pendingRuns()).toEqual([]);
  const failures = readLog(f.automation.store).filter((entry) => entry.kind === 'outbox-failed');
  expect(failures).toHaveLength(OUTBOX_RETRY_LIMIT);
  expect(failures[0]).toMatchObject({ error: 'gh: HTTP 502', final: false });
  expect(failures.at(-1)).toMatchObject({ final: true });
  expect(f.tickets).toEqual([]);
});

test('one failing entry does not block another case: its reply posts in the same flush', async () => {
  const f = fixture({ trackerFails: true });
  const first = await dispatch(f.automation, '1762900000.000100');
  expect(await f.automation.complete(first, CREATE)).toMatchObject({ status: 'retrying' });
  const second = await dispatch(f.automation, '1762900000.000200');
  expect(await f.automation.complete(second, 'Not a defect.\n[benny:other]')).toMatchObject({ status: 'queued' });
  expect(f.posts).toEqual([{ threadTs: '1762900000.000200', text: 'Not a defect.\n[benny:other]' }]);
  expect(f.automation.pendingRuns()).toEqual([first]);
});

test('a failing reply post is retried with backoff and posts once when Slack recovers', async () => {
  const f = fixture({ failPosts: 2 });
  const runId = await dispatch(f.automation, '1762900000.000100');
  expect(await f.automation.complete(runId, VERDICT)).toMatchObject({ status: 'retrying' });
  expect(await f.automation.complete(runId, VERDICT)).toMatchObject({ status: 'retrying' });
  expect(f.automation.pendingRuns()).toEqual([runId]);
  advance(60_000);
  expect(await f.automation.complete(runId, VERDICT)).toMatchObject({ status: 'retrying' });
  advance(60_000);
  expect(await f.automation.complete(runId, VERDICT)).toMatchObject({ status: 'already-queued' });
  expect(f.posts).toEqual([{ threadTs: '1762900000.000100', text: VERDICT }]);
  expect(f.automation.pendingRuns()).toEqual([]);
  expect(outboxEntries(f.automation.store).every((entry) => entry.state === 'done')).toBe(true);
});

test('a restart retries a pending entry at once, whatever its backoff', async () => {
  const f = fixture({ failPosts: 1 });
  const runId = await dispatch(f.automation, '1762900000.000100');
  expect(await f.automation.complete(runId, VERDICT)).toMatchObject({ status: 'retrying' });
  const restarted = createAutomation(f.config, f.deps);
  await restarted.reconcile();
  expect(f.posts).toHaveLength(1);
  expect(await restarted.complete(runId, VERDICT)).toMatchObject({ status: 'already-queued' });
  expect(f.posts).toHaveLength(1);
});
