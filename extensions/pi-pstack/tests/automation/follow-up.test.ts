import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { type Automation, type AutomationConfig, type AutomationDeps, createAutomation } from '../../adapters/automation-events.ts';
import type { RunId, TrackerAction } from '../../src/automation/model.ts';
import type { ThreadDestination, ThreadMessage } from '../../src/automation/outbox.ts';
import { readLog } from '../../src/automation/store.ts';
import { settleWorker } from './benny-fakes.ts';

const CHANNEL = 'CSOURCE01';
const ROOT = '1762900000.000100';
const TRIAGE = 'UTRIAGE01';
const VERDICT = 'Reproducible export failure.\n[benny:bug]';
const MINUTES = 10;

let project: string;
let clock = 0;
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'follow-up-')));
  mkdirSync(join(project, '.pi'), { recursive: true });
  clock = Date.parse('2026-11-12T08:00:00Z');
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
const advance = (ms: number) => void (clock += ms);

function fixture() {
  const thread: ThreadMessage[] = [{ ts: ROOT, user: 'U1', text: 'Export is broken' }];
  const posts: { threadTs: string; text: string }[] = [];
  const comments: TrackerAction[] = [];
  const spawned: { runId: RunId; assignmentPath: string }[] = [];
  const destination: ThreadDestination = {
    readThread: async () => [...thread],
    post: async (action) => {
      posts.push({ threadTs: action.threadTs, text: action.text });
      const ts = `1762900001.${String(thread.length).padStart(6, '0')}`;
      thread.push({ ts, marker: action.id, user: TRIAGE, text: action.text });
      return { ts };
    },
  };
  const config: AutomationConfig = { name: 'benny-triage', kind: 'triage', projectRoot: project, sourceChannelId: CHANNEL, triageIdentityUserId: TRIAGE, budgets: { totalMinutes: 30, followUpMinutes: MINUTES } };
  const deps: AutomationDeps = {
    spawnWorker: async (runId, assignmentPath) => void spawned.push({ runId, assignmentPath }),
    destination,
    prerequisites: { tracker: async () => true },
    inputCommit: () => 'a'.repeat(40),
    now: () => new Date(clock),
    tracker: {
      searchByMarker: async () => [],
      create: async () => ({ id: '7' }),
      update: async () => ({ id: '7' }),
      comment: async (action) => {
        comments.push(action);
        return { id: action.targetId ?? '' };
      },
    },
    trackerPolicy: async () => ({ classification: 'bug', clearlyBroken: true, live: true, duplicate: 'none', sourceVerified: true, targetResolved: true, canCompensate: true }),
  };
  const automation: Automation = createAutomation(config, deps);
  const human = (text: string, user = 'U2') => {
    const ts = `1762900002.${String(thread.length).padStart(6, '0')}`;
    thread.push({ ts, user, text });
    return ts;
  };
  return { automation, thread, posts, comments, spawned, human, config, deps };
}

/** A case that finished: dispatched, its verdict posted, an issue created. */
async function completed(f: ReturnType<typeof fixture>): Promise<RunId> {
  const run = await f.automation.handle({ source_channel_id: CHANNEL, ts: ROOT, user: 'U1', text: 'Export is broken' });
  if (run.status !== 'dispatched') throw new Error('not dispatched');
  await f.automation.complete(run.runId, { text: VERDICT, tracker: { operation: 'create', title: 'Export is broken', body: 'Expected a file.' } });
  f.spawned.length = 0;
  return run.runId;
}

const roundBrief = (f: ReturnType<typeof fixture>, index = 0) => readFileSync(join(dirname(f.spawned[index]?.assignmentPath ?? ''), 'brief.md'), 'utf8');
const settle = (f: ReturnType<typeof fixture>, index: number, finalText: string) => settleWorker(project, f.spawned[index]?.runId as RunId, { phase: 'idle', finalText });

test('no worker starts while nobody has written in the thread, or for the triage identity or the parent itself', async () => {
  const f = fixture();
  await completed(f);
  await f.automation.advanceFollowUps();
  f.human('I already looked at this.', TRIAGE);
  await f.automation.advanceFollowUps();
  expect(f.spawned).toEqual([]);
});

test('a new human message starts one read-only worker with the case and the message, and a second pass adopts it', async () => {
  const f = fixture();
  await completed(f);
  f.human('<@UTRIAGE01> does this also happen on Chrome?');
  await f.automation.advanceFollowUps();
  await f.automation.advanceFollowUps();
  expect(f.spawned).toHaveLength(1);
  expect(JSON.parse(readFileSync(f.spawned[0]?.assignmentPath ?? '', 'utf8'))).toMatchObject({ role: 'owner', workspace: { mode: 'readonly', path: project }, capabilities: { mcp: 'none', env: 'minimal', externalWrite: false } });
  const brief = roundBrief(f);
  expect(brief).toContain('does this also happen on Chrome?');
  expect(brief).toContain('section 10');
  expect(brief).toContain('tracker issue: `7`');
  expect(brief).toContain('Reproducible export failure.');
  expect(brief).not.toContain('Export is broken');
});

test('the answer is posted once as a marker-free reply in the source thread', async () => {
  const f = fixture();
  await completed(f);
  f.human('does this also happen on Chrome?');
  await f.automation.advanceFollowUps();
  settle(f, 0, '{"text":"The report names Safari only. Nothing says Chrome is affected."}');
  await f.automation.advanceFollowUps();
  await f.automation.advanceFollowUps();
  expect(f.posts).toEqual([{ threadTs: ROOT, text: VERDICT }, { threadTs: ROOT, text: 'The report names Safari only. Nothing says Chrome is affected.' }]);
  expect(readLog(f.automation.store).filter((entry) => entry.kind === 'follow-up-completed')).toHaveLength(1);
  expect(f.spawned).toHaveLength(1);
});

test('a second verdict marker in a follow-up answer is dropped, so one run never emits two', async () => {
  const f = fixture();
  await completed(f);
  f.human('is it a bug?');
  await f.automation.advanceFollowUps();
  settle(f, 0, '{"text":"Yes.\\n[benny:bug]"}');
  await f.automation.advanceFollowUps();
  expect(f.posts).toEqual([{ threadTs: ROOT, text: VERDICT }]);
  expect(readLog(f.automation.store)).toContainEqual(expect.objectContaining({ kind: 'reply-refused', reason: expect.stringContaining('marker') }));
});

test('a tracker correction becomes one comment on the issue this case owns, from a body with no Source line', async () => {
  const f = fixture();
  await completed(f);
  f.human('Correction: it is Safari 17.1 only.');
  await f.automation.advanceFollowUps();
  settle(f, 0, '{"text":"","tracker":{"operation":"comment","targetId":"99","body":"Only Safari 17.1.\\nSource: https://slack.com/archives/COTHER/p1"}}');
  await f.automation.advanceFollowUps();
  expect(f.comments).toHaveLength(1);
  expect(f.comments[0]).toMatchObject({ operation: 'comment', targetId: '7', sourceUrl: 'https://slack.com/archives/CSOURCE01/p1762900000000100' });
  expect(f.comments[0]?.body).toBe('Only Safari 17.1.');
  expect(f.posts).toHaveLength(1);
});

test('a later message after an answered round starts round two with only the new messages', async () => {
  const f = fixture();
  await completed(f);
  f.human('first question');
  await f.automation.advanceFollowUps();
  settle(f, 0, '{"text":"first answer"}');
  await f.automation.advanceFollowUps();
  f.human('second question');
  await f.automation.advanceFollowUps();
  expect(f.spawned).toHaveLength(2);
  const brief = roundBrief(f, 1);
  expect(brief).toContain('second question');
  expect(brief).not.toContain('first question');
  expect(brief).not.toContain('first answer');
});

test('a stop request closes the window: later messages start nothing', async () => {
  const f = fixture();
  await completed(f);
  f.human('please stop commenting on this thread');
  await f.automation.advanceFollowUps();
  settle(f, 0, '{"text":"Stopping.","stop":true}');
  await f.automation.advanceFollowUps();
  f.human('one more thing');
  await f.automation.advanceFollowUps();
  expect(f.spawned).toHaveLength(1);
  expect(f.posts.at(-1)?.text).toBe('Stopping.');
  expect(readLog(f.automation.store)).toContainEqual(expect.objectContaining({ kind: 'follow-up-closed', reason: expect.stringContaining('stop') }));
});

test('the window is fixed: after it ends no round starts and a worker still running is closed without a post', async () => {
  const f = fixture();
  await completed(f);
  f.human('a question inside the window');
  await f.automation.advanceFollowUps();
  advance((MINUTES + 1) * 60_000);
  await f.automation.advanceFollowUps();
  f.human('a question after the window');
  settle(f, 0, '{"text":"too late"}');
  await f.automation.advanceFollowUps();
  expect(f.spawned).toHaveLength(1);
  expect(f.posts).toEqual([{ threadTs: ROOT, text: VERDICT }]);
  expect(readLog(f.automation.store)).toContainEqual(expect.objectContaining({ kind: 'follow-up-closed', reason: expect.stringContaining('window ended') }));
});

test('a restart in the middle of a round adopts that worker and starts no second one', async () => {
  const f = fixture();
  await completed(f);
  f.human('a question');
  await f.automation.advanceFollowUps();
  const restarted = createAutomation(f.config, f.deps);
  await restarted.reconcile();
  await restarted.advanceFollowUps();
  expect(f.spawned).toHaveLength(1);
  settle(f, 0, '{"text":"an answer"}');
  await restarted.advanceFollowUps();
  expect(f.posts.map((post) => post.text)).toEqual([VERDICT, 'an answer']);
});

test('a worker that failed leaves the thread alone and closes its round', async () => {
  const f = fixture();
  await completed(f);
  f.human('a question');
  await f.automation.advanceFollowUps();
  settleWorker(project, f.spawned[0]?.runId as RunId, { phase: 'failed', reason: 'model refused' });
  await f.automation.advanceFollowUps();
  expect(f.posts).toHaveLength(1);
  expect(readLog(f.automation.store)).toContainEqual(expect.objectContaining({ kind: 'follow-up-completed' }));
});
