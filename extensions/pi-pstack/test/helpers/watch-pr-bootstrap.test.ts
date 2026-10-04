import './leak-preload.ts';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { removeScratch, scratchDir } from './scratch.ts';
import { runProcess } from './watch-pr-process.ts';

const shipped = new URL('../../skills/poteto-mode/scripts', import.meta.url).pathname;
const scratch = (label: string): string => scratchDir(`watch-pr-${label}-`);

afterEach(removeScratch);

function freshScripts(): string {
  const root = scratch('scripts');
  cpSync(shipped, join(root, 'scripts'), { recursive: true, filter: (source) => !source.includes('node_modules') });
  return join(root, 'scripts');
}
const launcher = (scripts: string): string => join(scripts, 'watch-pr', 'watch-pr');
const keyPath = (scripts: string): string => join(scripts, 'node_modules', '.poteto-mode-tools-install-key');
const expectedKey = (scripts: string): string =>
  createHash('sha256')
    .update(readFileSync(join(scripts, 'package.json')))
    .update('\0')
    .update(readFileSync(join(scripts, 'bun.lock')))
    .digest('hex');

function launch(scripts: string, args: string[], cwd = scratch('cwd')) {
  const result = runProcess(['bun', launcher(scripts), ...args], { cwd, env: process.env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(), cwd };
}

test('bootstrap installs under the scripts directory, not the cwd, when the launcher runs from an unrelated directory', () => {
  const scripts = freshScripts();
  const run = launch(scripts, ['--help']);
  expect(run.code).toBe(0);
  expect(run.stdout).toContain('Usage');
  expect(existsSync(join(scripts, 'node_modules', 'commander', 'package.json'))).toBe(true);
  expect(existsSync(join(run.cwd, 'node_modules'))).toBe(false);
});

test('bootstrap writes the install key as sha256 of package.json, a NUL byte, then bun.lock, plus a newline', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  expect(readFileSync(keyPath(scripts), 'utf8')).toBe(`${expectedKey(scripts)}\n`);
});

test('bootstrap returns without reinstalling when the manifest, commander, and a matching key are present', async () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  const stamp = new Date('2000-01-01T00:00:00Z');
  utimesSync(keyPath(scripts), stamp, stamp);
  const before = statSync(keyPath(scripts)).mtimeMs;
  const again = launch(scripts, ['--help']);
  expect(again.code).toBe(0);
  expect(statSync(keyPath(scripts)).mtimeMs).toBe(before);
});

test('bootstrap reinstalls and rewrites the key when the stored key is stale', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  writeFileSync(keyPath(scripts), 'stale\n');
  expect(launch(scripts, ['--help']).code).toBe(0);
  expect(readFileSync(keyPath(scripts), 'utf8')).toBe(`${expectedKey(scripts)}\n`);
});

test('bootstrap derives a new key and reinstalls when package.json changes', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  const old = expectedKey(scripts);
  writeFileSync(join(scripts, 'package.json'), `${readFileSync(join(scripts, 'package.json'), 'utf8')}\n`);
  expect(launch(scripts, ['--help']).code).toBe(0);
  expect(expectedKey(scripts)).not.toBe(old);
  expect(readFileSync(keyPath(scripts), 'utf8')).toBe(`${expectedKey(scripts)}\n`);
});

test('bootstrap retries an interrupted install because the key file is only written after a verified install', () => {
  const scripts = freshScripts();
  launch(scripts, ['--help']);
  rmSync(keyPath(scripts));
  expect(launch(scripts, ['--help']).code).toBe(0);
  expect(existsSync(keyPath(scripts))).toBe(true);
});

test('a failed frozen install throws without converting failure into a watcher JSON envelope', () => {
  const scripts = freshScripts();
  const manifest = JSON.parse(readFileSync(join(scripts, 'package.json'), 'utf8'));
  writeFileSync(join(scripts, 'package.json'), JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, commander: '13.0.0' } }));
  const lockBefore = readFileSync(join(scripts, 'bun.lock'));
  const run = launch(scripts, ['--help']);
  expect(run.code).toBe(1);
  expect(run.stdout).not.toContain('"kind":"BLOCKER"');
  expect(run.stderr).toContain('bun install --frozen-lockfile exited with status');
  expect(readFileSync(join(scripts, 'bun.lock')).equals(lockBefore)).toBe(true);
  expect(existsSync(keyPath(scripts))).toBe(false);
});

test('launcher propagates a non-zero main result to the process exit status with empty stdout', () => {
  const scripts = freshScripts();
  const run = launch(scripts, ['--interval', '0']);
  expect(run.code).toBe(64);
  expect(run.stdout).toBe('');
});
