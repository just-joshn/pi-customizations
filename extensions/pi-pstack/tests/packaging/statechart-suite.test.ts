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

test('the upstream statechart suite passes against the generated skill', () => {
  // The suite builds relative symlinks from os.tmpdir() to the launcher, which only resolve when tmpdir has no
  // symlink in its path (macOS /var -> /private/var).
  const env = { ...process.env, TMPDIR: realpathSync(tmpdir()) };
  const result = spawnSync(node, ['--disable-warning=ExperimentalWarning', '--test', '--test-reporter=tap', ...readdirSync(`${root}/${suite}`).filter((name) => name.endsWith('.test.ts')).sort().map((name) => `${suite}/${name}`)], { cwd: root, env, encoding: 'utf8', timeout: 280_000, maxBuffer: 64 * 1024 * 1024 });
  const failures = result.stdout.split('\n').filter((line) => /^\s*not ok /.test(line));
  expect(failures).toEqual([]);
  expect(result.status, result.stderr).toBe(0);
  const count = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(result.stdout)?.[1]);
  expect(count('fail')).toBe(0);
  expect(count('pass')).toBeGreaterThan(100);
}, 300_000);
