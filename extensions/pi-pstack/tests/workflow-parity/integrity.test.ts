// A run is evidence only when its provider answered and the parent acted. These tests drive the real driver against a stand-in pi that
// leaves a recorded parent session, and check what the harness refuses to score.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { absence, check, evaluate, pass } from './lib/check.ts';
import { type RunOutcome, type RunSpec, runWorkflow } from './lib/driver.ts';
import type { Inconclusive } from './lib/integrity.ts';
import { assess } from './lib/integrity.ts';
import { report } from './lib/run.ts';
import { loadRun } from './lib/view.ts';

const FAKE_PI = join(import.meta.dirname, 'fixtures/fake-pi.mjs');
const SESSIONS = join(import.meta.dirname, 'fixtures/sessions');
const base: RunSpec = { family: 'integrity-test', runId: 'integrity-test', history: [{ message: 'init', files: { 'README.md': 'x\n' } }], prompt: () => '/noop', scenario: () => ({ actors: {} }) };

const outcomes: RunOutcome[] = [];
afterEach(() => {
  for (const outcome of outcomes.splice(0)) outcome.cleanup();
});

async function run(session: string, spec: Partial<RunSpec> = {}): Promise<RunOutcome> {
  process.env['FAKE_PI_MODE'] = 'busy';
  process.env['FAKE_PI_BUSY_MS'] = '0';
  process.env['FAKE_PI_SESSION'] = join(SESSIONS, session);
  const outcome = await runWorkflow({ ...base, ...spec }, 'scripted', { pi: FAKE_PI, rpcTimeoutMs: 5_000 });
  outcomes.push(outcome);
  return outcome;
}

const neverMerged = absence(check('t.never-merged', 'nothing was merged', [], () => pass('0 forge actions, none a merge')));

test('a parent that hit a 429 is INCONCLUSIVE with the provider text, and is recorded in meta.json', async () => {
  const outcome = await run('parent-429.jsonl');
  expect(outcome.meta.inconclusive).toEqual({ kind: 'provider-error', message: '429 Usage limit reached' });
  expect(
    report({
      family: 'integrity-test',
      driver: 'real',
      results: [],
      negatives: [],
      sandbox: outcome.sandbox,
      tmuxSocket: '',
      timedOut: false,
      stopReason: undefined,
      piStderr: '',
      inconclusive: outcome.meta.inconclusive as Inconclusive,
      findings: [],
      runMs: 0,
      negativesMs: 0,
      cleanup: () => {},
      known: [],
    }),
  ).toContain('== integrity-test (real driver): INCONCLUSIVE provider-error: 429 Usage limit reached ==');
});

test('a real-driver parent with no tool call and no reply is INCONCLUSIVE no-activity; a scripted one is a scenario', async () => {
  const outcome = await run('parent-silent.jsonl');
  expect(outcome.meta.inconclusive).toBeUndefined();
  expect(assess({ ...outcome.view, driver: 'real' })?.kind).toBe('no-activity');
});

test('a healthy parent is scored', async () => {
  const outcome = await run('parent-healthy.jsonl');
  expect(outcome.meta.inconclusive).toBeUndefined();
  expect(evaluate([neverMerged], outcome.view)[0]?.verdict).toBe('PASS');
});

test('a check that passes on an absent action is INCONCLUSIVE when the parent made no tool call or hit an error', async () => {
  for (const session of ['parent-silent.jsonl', 'parent-429.jsonl']) {
    const outcome = await run(session);
    const [result] = evaluate([neverMerged], outcome.view);
    expect(result?.verdict).toBe('INCONCLUSIVE');
    expect(result?.evidence).toContain('would have passed: 0 forge actions, none a merge');
  }
});

test('a drive hook that throws records crashed in meta.json, keeps the sandbox, and the run is INCONCLUSIVE crash', async () => {
  const outcome = await run('parent-healthy.jsonl', {
    drive: async () => {
      throw new Error('timed out waiting for the watcher');
    },
  });
  expect(outcome.meta.crashed).toBe('timed out waiting for the watcher');
  expect(outcome.meta.inconclusive).toEqual({ kind: 'crash', message: 'timed out waiting for the watcher' });
  expect(JSON.parse(readFileSync(join(outcome.sandbox, 'meta.json'), 'utf8')).crashed).toBe('timed out waiting for the watcher');
});

const abortedTurn = (stopReason: string, errorMessage: string) => `${JSON.stringify({ type: 'message', id: 'a1', message: { role: 'assistant', content: [], stopReason, errorMessage } })}\n`;

function workerErrors(settles: unknown[], turn: string): string[] {
  const project = mkdtempSync(join(tmpdir(), 'pstack-view-'));
  try {
    const dir = join(project, '.pi', 'pstack', 'runs', 'r', 'workers', 'w');
    mkdirSync(join(dir, 'session'), { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ settles }));
    writeFileSync(join(dir, 'session', 's.jsonl'), turn);
    return loadRun(project, 'r').workers[0]?.session?.errors ?? [];
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

test('a turn the parent aborted is not a provider error on Pi 1.5.0, which records it as stopReason error', () => {
  const aborted = [{ phase: 'aborted', reason: 'Stopped by request' }];
  expect(workerErrors(aborted, abortedTurn('error', 'This operation was aborted'))).toEqual([]);
  expect(workerErrors(aborted, abortedTurn('aborted', 'This operation was aborted'))).toEqual([]);
});

test('the same abort text on a worker nobody aborted, and any other error on an aborted worker, stay provider errors', () => {
  expect(workerErrors([{ phase: 'idle' }], abortedTurn('error', 'This operation was aborted'))).toEqual(['This operation was aborted']);
  expect(workerErrors([{ phase: 'aborted' }], abortedTurn('error', '429 Usage limit reached'))).toEqual(['429 Usage limit reached']);
});
