import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { type Automation, type AutomationConfig, type AutomationDeps, createAutomation } from '../../adapters/automation-events.ts';
import type { ThreadMessage } from '../../src/automation/outbox.ts';
import { startSettler } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';

const CHANNEL = 'CSOURCE01';
const ROOT = '1762900000.000100';
const TRIAGE = 'UTRIAGE01';
const WAIT_MINUTES = 45;
const EVENT = { source_channel_id: CHANNEL, ts: ROOT, user: 'U1', text: 'Export is broken' };

let project: string;
let clock = 0;
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'verdict-wait-')));
  clock = Date.parse('2026-11-12T08:00:00Z');
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
const later = (minutes: number) => void (clock += minutes * 60_000);

function fixture() {
  const thread: ThreadMessage[] = [{ ts: ROOT, user: 'U1', text: 'Export is broken' }];
  const spawns: string[] = [];
  const posts: string[] = [];
  const probes = { tracker: 0 };
  const config: AutomationConfig = { name: 'benny-reproduce', kind: 'reproduce', projectRoot: project, sourceChannelId: CHANNEL, triageIdentityUserId: TRIAGE, budgets: { totalMinutes: 60, followUpMinutes: 45, verdictWaitMinutes: WAIT_MINUTES } };
  const deps: AutomationDeps = {
    spawnWorker: async (runId) => void spawns.push(runId),
    destination: {
      readThread: async () => [...thread],
      post: async (action) => {
        posts.push(action.text);
        thread.push({ ts: '1762900009.000000', marker: action.id, user: TRIAGE, text: action.text });
        return { ts: '1762900009.000000' };
      },
    },
    prerequisites: { tracker: async () => (probes.tracker++, true), controlAdapter: async () => true, featureMap: async () => true },
    inputCommit: () => 'a'.repeat(40),
    now: () => new Date(clock),
  };
  const automation: Automation = createAutomation(config, deps);
  const say = (user: string, text: string) => void thread.push({ ts: `1762900001.${String(thread.length).padStart(6, '0')}`, user, text });
  return { automation, thread, spawns, posts, probes, say, config, deps };
}

test('a repro event with no triage verdict yet waits and starts nothing, instead of being rejected', async () => {
  const f = fixture();
  expect(await f.automation.handle(EVENT)).toEqual({ status: 'waiting', key: `${CHANNEL}:${ROOT}` });
  expect(f.spawns).toEqual([]);
  expect(f.posts).toEqual([]);
  expect(f.probes.tracker).toBe(0);
  expect(readLog(f.automation.store).filter((entry) => entry.kind === 'rejected')).toEqual([]);
});

test('the case dispatches once when the trusted verdict arrives inside the wait, and later checks do nothing', async () => {
  const f = fixture();
  await f.automation.handle(EVENT);
  later(5);
  await f.automation.retryWaiting();
  expect(f.spawns).toEqual([]);
  f.say(TRIAGE, 'Reproducible.\n[benny:bug]');
  later(5);
  await f.automation.retryWaiting();
  await f.automation.retryWaiting();
  expect(f.spawns).toHaveLength(1);
  expect(f.posts).toEqual([]);
  expect(readLog(f.automation.store).filter((entry) => entry.kind === 'awaiting-verdict')).toHaveLength(1);
});

test('a restart in the middle of the wait keeps waiting, and the verdict that arrives after it still starts the case once', async () => {
  const f = fixture();
  await f.automation.handle(EVENT);
  later(10);
  const restarted = createAutomation(f.config, f.deps);
  await restarted.reconcile();
  expect(f.spawns).toEqual([]);
  f.say(TRIAGE, 'Reproducible.\n[benny:performance]');
  await restarted.retryWaiting();
  await restarted.reconcile();
  expect(f.spawns).toHaveLength(1);
});

test('the wait ends at verdict_wait_minutes: the case is rejected once, silently, and a verdict after that starts nothing', async () => {
  const f = fixture();
  await f.automation.handle(EVENT);
  later(WAIT_MINUTES - 1);
  await f.automation.retryWaiting();
  expect(readLog(f.automation.store).filter((entry) => entry.kind === 'rejected')).toEqual([]);
  later(2);
  await f.automation.retryWaiting();
  await f.automation.retryWaiting();
  const rejected = readLog(f.automation.store).filter((entry) => entry.kind === 'rejected');
  expect(rejected).toEqual([expect.objectContaining({ key: `${CHANNEL}:${ROOT}`, reason: expect.stringContaining(`${WAIT_MINUTES} minutes`) })]);
  f.say(TRIAGE, 'Late.\n[benny:bug]');
  await f.automation.retryWaiting();
  await f.automation.reconcile();
  expect(f.spawns).toEqual([]);
  expect(f.posts).toEqual([]);
  expect(await f.automation.handle(EVENT)).toMatchObject({ status: 'rejected' });
});

test.for([
  ['an other verdict', 'Not a defect.\n[benny:other]'],
  ['a verdict from someone who is not the triage identity', 'Looks like a bug.\n[benny:bug]', 'UWRONG'],
])('%s stops the case at once instead of waiting out the budget', async ([, text, user]) => {
  const f = fixture();
  f.say(user ?? TRIAGE, text as string);
  expect(await f.automation.handle(EVENT)).toMatchObject({ status: 'rejected' });
  expect(f.spawns).toEqual([]);
  expect(readLog(f.automation.store)).toContainEqual(expect.objectContaining({ kind: 'rejected', key: `${CHANNEL}:${ROOT}` }));
});

test('without a verdict_wait_minutes the old behavior holds: no verdict at event time is a rejection', async () => {
  const f = fixture();
  const { budgets: _budgets, ...bare } = f.config;
  const automation = createAutomation({ ...bare, budgets: { totalMinutes: 60, followUpMinutes: 45 } }, f.deps);
  expect(await automation.handle(EVENT)).toMatchObject({ status: 'rejected' });
});

test('the settler\'s own polling dispatches a waiting case once its verdict is posted', async () => {
  const f = fixture();
  await f.automation.handle(EVENT);
  const settler = startSettler(f.automation, { intervalMs: 50 });
  try {
    f.say(TRIAGE, 'Reproducible.\n[benny:bug]');
    const end = Date.now() + 10_000;
    while (f.spawns.length === 0 && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
  } finally {
    await settler.stop();
  }
  expect(f.spawns).toHaveLength(1);
});
