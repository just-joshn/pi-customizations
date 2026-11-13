// A real-model run is stopped for going quiet or for reaching its ceiling, and never while it is still working.
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { budgetFor, stopReason } from './lib/budget.ts';
import { budgetOf, runWorkflow } from './lib/driver.ts';
import type { Meta, RunSpec } from './lib/driver.ts';
import { assessHarnessStop } from './lib/integrity.ts';

const FAKE_PI = join(import.meta.dirname, 'fixtures/fake-pi.mjs');
const spec: RunSpec = { family: 'budget-test', runId: 'budget-test', history: [{ message: 'init', files: { 'README.md': 'x\n' } }], prompt: () => '/noop', scenario: () => ({ actors: {} }) };
const run = async (mode: string, busyMs: number, budget: { idleMs: number; ceilingMs: number }) => {
  process.env['FAKE_PI_MODE'] = mode;
  process.env['FAKE_PI_BUSY_MS'] = String(busyMs);
  const outcome = await runWorkflow(spec, 'scripted', { pi: FAKE_PI, rpcTimeoutMs: 1_500, budget });
  outcome.cleanup();
  return outcome.meta;
};

describe('stopReason', () => {
  const budget = { idleMs: 10, ceilingMs: 100 };
  test('a run that made progress within idleMs and is under its ceiling goes on', () => {
    expect(stopReason(budget, 0, 95, 99)).toBeNull();
  });
  test('a run quiet for idleMs stops as idle, however young', () => {
    expect(stopReason(budget, 0, 20, 30)).toBe('idle');
  });
  test('a run that keeps progressing still stops at the ceiling', () => {
    expect(stopReason(budget, 0, 99, 100)).toBe('ceiling');
  });
});

describe('budgetFor', () => {
  test('fixture timeouts apply only to scripted runs, never to a real model', () => {
    const fixture = { ...spec, timeoutMs: 120_000 };
    expect(budgetOf(fixture, 'scripted')).toEqual({ idleMs: 120_000, ceilingMs: 120_000 });
    expect(budgetOf(fixture, 'real')).toEqual(budgetFor(fixture.family));
  });

  test('a fan-out family gets a longer ceiling than a single-agent one, and both share one idle limit', () => {
    expect(budgetFor('feature').ceilingMs).toBeGreaterThan(budgetFor('how-simple').ceilingMs);
    expect(budgetFor('feature').idleMs).toBe(budgetFor('how-simple').idleMs);
  });
});

describe('stopped-run provenance', () => {
  const stopped: Meta = { family: spec.family, driver: 'real', base: 'base', parentSessionFile: null, prompt: '/noop', timedOut: true, stopReason: 'ceiling', tmuxSocket: 'socket', piStderr: '' };
  const fixture = { ...spec, timeoutMs: 120_000 };

  test('a legacy real run cut short by its fixture budget is a harness failure', () => {
    expect(assessHarnessStop(stopped, fixture)).toMatchObject({ kind: 'harness-budget' });
  });

  test('a real run that exhausts the product budget remains a timeout', () => {
    expect(assessHarnessStop({ ...stopped, budget: budgetFor(spec.family) }, fixture)).toBeUndefined();
    expect(assessHarnessStop(stopped, spec)).toBeUndefined();
  });

  test('a shorter recorded test override cannot be mistaken for product budget exhaustion', () => {
    expect(assessHarnessStop({ ...stopped, budget: { idleMs: 100, ceilingMs: 100 } }, spec)).toMatchObject({ kind: 'harness-budget' });
  });

  test('scripted stops and completed real runs are not reclassified', () => {
    expect(assessHarnessStop({ ...stopped, driver: 'scripted' }, fixture)).toBeUndefined();
    expect(assessHarnessStop({ ...stopped, timedOut: false }, fixture)).toBeUndefined();
  });
});

describe('the driver under a budget', () => {
  test('a real-driver parent outlives the scripted fixture limit and records the real budget', async () => {
    process.env['FAKE_PI_MODE'] = 'busy';
    process.env['FAKE_PI_BUSY_MS'] = '500';
    const outcome = await runWorkflow({ ...spec, timeoutMs: 100 }, 'real', { pi: FAKE_PI, model: 'sim/claude-sim', rpcTimeoutMs: 1_500 });
    try {
      expect(outcome.meta).toMatchObject({ timedOut: false, budget: budgetFor(spec.family) });
      expect(outcome.meta.inconclusive?.kind).not.toBe('harness-budget');
    } finally {
      outcome.cleanup();
    }
  }, 15_000);

  test('a run that keeps working past the idle limit, inside the ceiling, is not stopped', async () => {
    const meta = await run('busy', 9_000, { idleMs: 4_000, ceilingMs: 30_000 });
    expect({ timedOut: meta.timedOut, why: meta.stopReason }).toEqual({ timedOut: false, why: undefined });
    expect(meta.stopReason).toBeUndefined();
  }, 30_000);

  test('a run that goes quiet is stopped as idle long before its ceiling', async () => {
    const started = Date.now();
    const meta = await run('stalled', 0, { idleMs: 4_000, ceilingMs: 60_000 });
    expect(meta).toMatchObject({ timedOut: true, stopReason: 'idle' });
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  test('a run that never goes quiet is stopped at the ceiling', async () => {
    const meta = await run('busy', 60_000, { idleMs: 5_000, ceilingMs: 2_500 });
    expect(meta).toMatchObject({ timedOut: true, stopReason: 'ceiling' });
  }, 30_000);
});
