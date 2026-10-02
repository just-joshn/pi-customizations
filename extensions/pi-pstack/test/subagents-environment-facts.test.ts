import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { directorySnapshot, gatherEnvironment, type Probe, systemProbe as probeOf } from '../src/subagents/environment-facts.ts';
import { nodeExec } from './support/node-exec.ts';
import { scratchDir } from './support/scratch.ts';

const realProbe = () => probeOf(nodeExec);

const probe = (overrides: Partial<Probe> = {}): Probe => ({
  git: async () => '/repo',
  entries: () => [
    { name: 'src', directory: true },
    { name: 'a.txt', directory: false },
  ],
  onPath: (binary) => binary !== 'curl',
  osName: () => 'Linux',
  ...overrides,
});

test('facts combine the repository root, os name, snapshot and the tools found on the path', async () => {
  await expect(gatherEnvironment('/repo', probe())).resolves.toEqual({ cwd: '/repo', gitRoot: '/repo', os: 'Linux', listing: 'a.txt\nsrc/', tools: ['git', 'gh'] });
});

test('a directory outside a repository has no git root and an empty one has no listing', async () => {
  await expect(gatherEnvironment('/tmp/x', probe({ git: async () => undefined, entries: () => [] }))).resolves.toEqual({ cwd: '/tmp/x', os: 'Linux', tools: ['git', 'gh'] });
});

test('the snapshot hides git and node_modules and caps the entry count', () => {
  const many = Array.from({ length: 45 }, (_, index) => ({ name: `f${String(index).padStart(2, '0')}`, directory: false }));
  const lines = directorySnapshot([{ name: '.git', directory: true }, { name: 'node_modules', directory: true }, ...many])?.split('\n') ?? [];
  expect(lines).toHaveLength(41);
  expect(lines.at(-1)).toBe('... 5 more');
  expect(lines[0]).toBe('f00');
});

test('the system probe reads a real directory and a real repository root', async () => {
  const dir = scratchDir('pstack-env-facts-');
  const systemProbe = realProbe();
  mkdirSync(join(dir, 'pkg'));
  writeFileSync(join(dir, 'a.txt'), 'x');
  expect(systemProbe.entries(dir).toSorted((left, right) => left.name.localeCompare(right.name))).toEqual([
    { name: 'a.txt', directory: false },
    { name: 'pkg', directory: true },
  ]);
  expect(systemProbe.entries(join(dir, 'missing'))).toEqual([]);
  await expect(systemProbe.git(dir)).resolves.toBeUndefined();
  expect(systemProbe.onPath('definitely-not-a-real-binary-name')).toBe(false);
  expect(systemProbe.osName().length).toBeGreaterThan(0);
});

test('the system probe reports the root of a real repository', async () => {
  const dir = scratchDir('pstack-env-facts-');
  await nodeExec('git', ['init', '-q'], { cwd: dir });
  await expect(realProbe().git(dir)).resolves.toBe(realpathSync(dir));
});
