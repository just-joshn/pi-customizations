// The driver reports a pi that cannot run as that, with pi's stderr, and never as the ENOENT of a file it then reads.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { runWorkflow } from './lib/driver.ts';
import type { RunSpec } from './lib/driver.ts';

const FAKE_PI = join(import.meta.dirname, 'fixtures/fake-pi.mjs');
const spec: RunSpec = { family: 'driver-test', runId: 'driver-test', history: [{ message: 'init', files: { 'README.md': 'x\n' } }], prompt: () => '/noop', scenario: () => ({ actors: {} }) };
const withPi = (mode: string) => {
  process.env['FAKE_PI_MODE'] = mode;
  return runWorkflow(spec, 'scripted', { pi: FAKE_PI, rpcTimeoutMs: 1_500 });
};

test('a pi that crashes at start is reported with its exit and stderr', async () => {
  await expect(withPi('crash')).rejects.toThrow(/pi exited \(code 3[^)]*\) before.*fatal: provider auth missing/s);
});

test('a pi that never answers is reported as unanswered with the request that hung', async () => {
  await expect(withPi('silent')).rejects.toThrow(/get_state: no answer within 1500 ms/);
});

test('a pi that runs but writes no session is reported as that, not as a missing file', async () => {
  await expect(withPi('no-session')).rejects.toThrow(/left no session file/);
});

test('a sandbox removed under the run is reported as removed', async () => {
  await expect(withPi('sandbox-removed')).rejects.toThrow(/is gone or gutted .*something outside this run removed it/);
});

test('a failed run leaves no sandbox behind', async () => {
  let sandbox = '';
  process.env['FAKE_PI_MODE'] = 'crash';
  await expect(runWorkflow({ ...spec, prepare: (ctx) => void (sandbox = ctx.sandbox) }, 'scripted', { pi: FAKE_PI, rpcTimeoutMs: 1_500 })).rejects.toThrow();
  expect(sandbox).not.toBe('');
  expect(existsSync(sandbox)).toBe(false);
});
