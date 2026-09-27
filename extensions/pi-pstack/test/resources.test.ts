import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-resources-'));
  await mkdir(join(directory, 'docs'));
  await mkdir(join(directory, 'scripts'));
  for (const path of [
    'upstream', 'upstream-team-kit', 'skills', 'scripts/resources.mjs',
    'docs/source-inventory.json', 'docs/team-kit-source-inventory.json', 'docs/resource-map.json',
  ]) await cp(join(root, path), join(directory, path), { recursive: true, filter: source => !source.split('/').includes('node_modules') });
  return {
    directory,
    run: (...args: string[]) => execFileSync(process.execPath, [join(directory, 'scripts/resources.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' }),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test('resource generation is reproducible across both source bundles', async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.directory, 'docs/resource-map.json'));
    assert.match(f.run('--write'), /187 upstream files and 143 generated skill resources/);
    assert.deepEqual(await readFile(join(f.directory, 'docs/resource-map.json')), before);
    assert.match(f.run(), /187 upstream files and 143 generated skill resources/);
  } finally { await f.close(); }
});

test('a changed kit source prevents all generation writes', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'skills/bro/SKILL.md');
    await writeFile(target, 'Existing generated sentinel');
    await writeFile(join(f.directory, 'upstream-team-kit/skills/deslop/SKILL.md'), 'Changed source');
    assert.throws(() => f.run('--write'), /Upstream hash mismatch: upstream-team-kit\/skills\/deslop\/SKILL.md/);
    assert.equal(await readFile(target, 'utf8'), 'Existing generated sentinel');
  } finally { await f.close(); }
});

test('overlapping source destinations fail before changing generated skills', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'skills/bro/SKILL.md');
    await writeFile(target, 'Existing generated sentinel');
    const script = join(f.directory, 'scripts/resources.mjs');
    const original = await readFile(script, 'utf8');
    await writeFile(script, original.replace(
      "{ directory: 'upstream-team-kit', inventory: 'docs/team-kit-source-inventory.json' }",
      "{ directory: 'upstream', inventory: 'docs/source-inventory.json' }",
    ));
    assert.throws(() => f.run('--write'), /Duplicate generated skill destination across source bundles/);
    assert.equal(await readFile(target, 'utf8'), 'Existing generated sentinel');
  } finally { await f.close(); }
});
