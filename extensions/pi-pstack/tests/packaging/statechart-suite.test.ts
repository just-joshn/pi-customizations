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
 * Upstream's signal tests poll the command's temporary folder with a recursive directory listing while the command creates and removes
 * it, so a loaded machine can make the listing throw ENOENT before any signal is sent. The package's launcher is not involved. A run
 * that fails only these tests runs them again on their own; any other failure, or a second failure, fails here.
 */
const RACING_NAME = 'while the command writes its files stops it, and it writes nothing';
const racing = (name: string) => name.endsWith(RACING_NAME);

function runSuite(extraArgs: string[], timeout: number) {
  // The suite builds relative symlinks from os.tmpdir() to the launcher, which only resolve when tmpdir has no
  // symlink in its path (macOS /var -> /private/var).
  const env = { ...process.env, TMPDIR: realpathSync(tmpdir()) };
  const files = readdirSync(`${root}/${suite}`).filter((name) => name.endsWith('.test.ts')).sort().map((name) => `${suite}/${name}`);
  const result = spawnSync(node, ['--disable-warning=ExperimentalWarning', '--test', '--test-reporter=tap', ...extraArgs, ...files], { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const failures = result.stdout.split('\n').filter((line) => /^\s*not ok /.test(line)).map((line) => line.replace(/^\s*not ok \d+ - /, ''));
  const count = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(result.stdout)?.[1]);
  return { result, failures, ran: count('pass') + count('fail') };
}

test('the upstream statechart suite passes against the generated skill', () => {
  const whole = runSuite([], 600_000);
  expect(whole.ran).toBeGreaterThan(100);
  const final = whole.failures.length > 0 && whole.failures.every(racing) ? runSuite(['--test-name-pattern', RACING_NAME], 100_000) : whole;
  expect(final.failures).toEqual([]);
  expect(final.result.status, final.result.stderr).toBe(0);
}, 760_000);
