import { existsSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { recordPair } from '../recorder/pair.mjs';

const fixture = fileURLToPath(new URL('./recorder-fixture.mjs', import.meta.url));
const digest = `sha256:${'a'.repeat(64)}`;
const side = (name, fixtureDigest = digest) => ({
  side: name,
  scenarioRef: 'fixture:isatty-resize',
  fixtureRef: { path: tmpdir(), digest: fixtureDigest },
  artifactPaths: [],
  launch: { argv: [process.execPath, fixture, '3'], cwd: tmpdir(), env: { TERM: 'xterm-256color' } },
  geometry: { rows: 24, cols: 80 },
});
const steps = [{ waitFor: 'ready' }, { resize: { rows: 30, cols: 90 } }, { send: 'hello\r', origin: 'literal_user' }];

test('records both sides with the same literal input script and no verdict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-'));
  const pair = await recordPair({ root, scenarioRef: 'fixture:isatty-resize', steps, cursor: side('cursor'), pi: side('pi') });
  const saved = JSON.parse(await readFile(join(pair.dir, 'pair.json'), 'utf8'));
  expect(saved.steps).toEqual(steps);
  expect(saved.cursor.attemptId).not.toBe(saved.pi.attemptId);
  expect(saved.fixtureDigest).toBe(digest);
  expect(Object.keys(saved).join()).not.toMatch(/verdict|pass|parity|match/);
  for (const s of ['cursor', 'pi']) {
    const log = JSON.parse(await readFile(join(saved[s].dir, 'identity.json'), 'utf8'));
    expect(log.side).toBe(s);
  }
});

test('refuses a pair whose fixture digests differ', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-'));
  const other = `sha256:${'b'.repeat(64)}`;
  await expect(recordPair({ root, scenarioRef: 'x', steps, cursor: side('cursor'), pi: side('pi', other) })).rejects.toThrow(/fixture digest/);
});

test('fails the step when the awaited output never appears', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-'));
  await expect(
    recordPair({
      root,
      scenarioRef: 'x',
      steps: [{ waitFor: 'never-printed', timeoutMs: 300 }],
      cursor: side('cursor'),
      pi: side('pi'),
    }),
  ).rejects.toThrow(/never-printed/);
});

test('a failed pair leaves a failure record and no pair.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pair-'));
  await expect(recordPair({ root, scenarioRef: 'x', steps: [{ waitFor: 'never-printed', timeoutMs: 200 }], cursor: side('cursor'), pi: side('pi') })).rejects.toThrow();
  const [dirName] = readdirSync(root);
  const failure = JSON.parse(readFileSync(join(root, dirName, 'failure.json'), 'utf8'));
  expect(failure.error).toMatch(/never-printed/);
  expect(existsSync(join(root, dirName, 'pair.json'))).toBe(false);
});

test('refuses a symlinked pair root', async () => {
  const real = await mkdtemp(join(tmpdir(), 'pair-'));
  const link = join(await mkdtemp(join(tmpdir(), 'lnk-')), 'root');
  symlinkSync(real, link);
  await expect(recordPair({ root: link, scenarioRef: 'x', steps, cursor: side('cursor'), pi: side('pi') })).rejects.toThrow(/real directory/);
});
