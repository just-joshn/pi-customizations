// The upstream statechart suite (generated/skills/statechart/scripts/test) runs as shipped. It passes only when the
// package's one rewrite of the launcher, which points the entry at dist/statechart.js, has a matching rule for the
// test that expects the launcher's entry (adapters/cursor-to-pi.ts, statechart.installed-entry-test).
import { spawnSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const suite = 'generated/skills/statechart/scripts/test';
const node = process.env['PSTACK_HELPER_NODE'] ?? process.execPath;

/**
 * Upstream's signal tests ("while the command writes its files") send the signal when a synchronous poll of the command's output folder
 * sees chart.mmd. Measured on the whole suite run by `node --test` with its default file concurrency, with nothing else running, they failed
 * in 2 of 6 runs (stderr empty: the command finished before the signal landed); with --test-concurrency=1, 0 of 5; run alone, 0 of 20.
 * So the other upstream files running beside cli.test.ts are the contention. Its file runs alone, every time, then the rest run together.
 */
const SUITE_FILES = readdirSync(`${root}/${suite}`)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => `${suite}/${name}`);
/**
 * Measured with real TLC. Locally (10 runs under Vitest): 163 to 173 s in all, of which cli.test.ts alone is 39 to 43 s (8 runs) and the
 * other files about 125 s. On the Linux runner the one-invocation suite took about 279 s (run 43356789068: it was the last file in flight, started
 * at +359 s, Vitest finished at +638.6 s), so cli.test.ts is about 80 s there and the rest about 200 s. Each limit is twice that estimate or more.
 */
const ALONE_TIMEOUT = 180_000;
const REST_TIMEOUT = 400_000;
const TEST_TIMEOUT = ALONE_TIMEOUT + REST_TIMEOUT + 60_000;
const ALONE = `${suite}/cli.test.ts`;

function runSuite(files: string[], timeout: number) {
  // The suite builds relative symlinks from os.tmpdir() to the launcher, which only resolve when tmpdir has no
  // symlink in its path (macOS /var -> /private/var).
  const env = { ...process.env, TMPDIR: realpathSync(tmpdir()) };
  const result = spawnSync(node, ['--disable-warning=ExperimentalWarning', '--test', '--test-reporter=tap', ...files], { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const failures = result.stdout
    .split('\n')
    .filter((line) => /^\s*not ok /.test(line))
    .map((line) => line.replace(/^\s*not ok \d+ - /, ''));
  const count = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(result.stdout)?.[1]);
  return { result, failures, ran: count('pass') + count('fail') };
}

test(
  'the upstream statechart suite passes against the generated skill',
  () => {
    const alone = runSuite([ALONE], ALONE_TIMEOUT);
    const rest = runSuite(
      SUITE_FILES.filter((file) => file !== ALONE),
      REST_TIMEOUT,
    );
    expect([...alone.failures, ...rest.failures]).toEqual([]);
    expect(alone.ran + rest.ran).toBeGreaterThan(100);
    expect(alone.result.status, alone.result.stderr).toBe(0);
    expect(rest.result.status, rest.result.stderr).toBe(0);
  },
  TEST_TIMEOUT,
);
