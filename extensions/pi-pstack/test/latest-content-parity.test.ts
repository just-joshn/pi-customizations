import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFile(fileURLToPath(new URL(path, root)), 'utf8');

test('perf issue delivers the seven performance mantras in order', async () => {
  const delivered = await text('skills/poteto-mode/playbooks/perf-issue.md');
  expect(delivered.match(/^ {3}\d\. .+$/gm)).toEqual([
    "   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.",
    "   2. Do it, but don't do it again.",
    '   3. Do it less.',
    '   4. Do it later.',
    "   5. Do it when they're not looking.",
    '   6. Do it concurrently.',
    '   7. Do it cheaper.',
  ]);
});

test('perf issue removes the eight strategy families and stops when an earlier mantra meets the target', async () => {
  const delivered = await text('skills/poteto-mode/playbooks/perf-issue.md');
  expect(delivered).toContain('When an earlier mantra meets the target, stop.');
  expect(delivered).not.toContain('strategy families');
  for (const family of ['Elimination', 'Divide and conquer', 'Caching', 'Indirection', 'Batching', 'Redundancy', 'Lazy evaluation', 'Scheduling']) {
    expect(delivered).not.toContain(`**${family}.**`);
  }
});

test('hillclimb borrows the mantra ordering without the perf issue stop rule', async () => {
  const delivered = await text('skills/poteto-mode/playbooks/hillclimb.md');
  expect(delivered).toContain("For a perf metric, order hypotheses by the performance mantras in step 2 of the Perf issue playbook (`playbooks/perf-issue.md`). Borrow only their order, not that step's stop rule.");
});

test('benchmark checklist refers to the performance mantras', async () => {
  const delivered = await text('skills/benchmark-checklist/SKILL.md');
  expect(delivered).toContain('the performance mantras in its step 2 generate the fixes');
  expect(delivered).not.toContain('strategy families');
});

test('architect screens candidates for the next agent contributor', async () => {
  const delivered = await text('skills/architect/SKILL.md');
  expect(delivered).toContain('Assume the next contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles.');
  expect(delivered).toContain('Prefer the design where a change that looks right from one file is right for the whole repo.');
});

test('architect delivers the new ownership and single-path design flags', async () => {
  const delivered = await text('skills/architect/references/design-red-flags.md');
  expect(delivered).toContain('## Split ownership\n\nMore than one module writes the same state or keeps its own copy of it.');
  expect(delivered).toContain('Give each piece of state one owner. Other modules read it or ask the owner to change it.');
  expect(delivered).toContain('## Two ways to do one task');
  expect(delivered).toContain('Keep one way. Move callers off the others and delete them in the same change.');
  expect(delivered).toContain('## Importable internals');
  expect(delivered).toContain('## Hand-synced list');
});

test('package and provenance identify the delivered upstream release', async () => {
  expect(JSON.parse(await text('package.json')).version).toBe('0.15.15-pi.1');
  expect(JSON.parse(await text('upstream/plugin-metadata/plugin.json')).version).toBe('0.15.15');
  expect(JSON.parse(await text('docs/provenance.json')).pstack).toMatchObject({
    commit: expect.stringMatching(/^[a-f0-9]{40}$/),
    version: '0.15.15',
  });
  expect(await text('README.md')).toContain('ports pstack 0.15.15');
  expect(await text('../../README.md')).toContain('pstack 0.15.15 workflow plugin');
  expect(await text('CHANGELOG.md')).toContain('## 0.15.15-pi.1');
});
