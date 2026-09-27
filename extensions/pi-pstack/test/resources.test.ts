import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
    'upstream', 'upstream-team-kit', 'skills', 'prompts', 'package.json', 'scripts/resources.mjs',
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
    assert.match(f.run('--write'), /187 upstream files and 205 generated resources/);
    assert.deepEqual(await readFile(join(f.directory, 'docs/resource-map.json')), before);
    assert.match(f.run(), /187 upstream files and 205 generated resources/);
  } finally { await f.close(); }
});

test('generation separates reusable prompts from procedural skills and Reference metadata', async () => {
  const f = await fixture();
  try {
    f.run('--write');
    assert.equal((await readdir(join(f.directory, 'prompts'))).length, 63);
    assert.equal((await readdir(join(f.directory, 'skills'))).length, 64);
    await assert.rejects(readFile(join(f.directory, 'skills/bro/SKILL.md')), { code: 'ENOENT' });
    assert.match(await readFile(join(f.directory, 'prompts/bro.md'), 'utf8'), /Restate your last message/);
    assert.match(await readFile(join(f.directory, 'prompts/architect.md'), 'utf8'), /architect\/SKILL\.md/);
    assert.match(await readFile(join(f.directory, 'prompts/architect.md'), 'utf8'), /\$ARGUMENTS/);
    await assert.rejects(readFile(join(f.directory, 'prompts/poteto-mode.md')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(f.directory, 'prompts/setup-pstack.md')), { code: 'ENOENT' });
    for (const name of ['poteto-mode', 'typescript-best-practices']) {
      const text = await readFile(join(f.directory, `skills/${name}/SKILL.md`), 'utf8');
      assert.doesNotMatch(text, /^(mode|icon|color|reminder|paths):/m);
    }
  } finally { await f.close(); }
});

test('generation migrates the former bro skill without deleting unrelated resources', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.directory, 'skills/bro'));
    await cp(join(f.directory, 'upstream/skills/bro/SKILL.md'), join(f.directory, 'skills/bro/SKILL.md'));
    f.run('--write');
    await assert.rejects(readFile(join(f.directory, 'skills/bro/SKILL.md')), { code: 'ENOENT' });
    assert.match(await readFile(join(f.directory, 'prompts/bro.md'), 'utf8'), /Restate your last message/);
    await writeFile(join(f.directory, 'prompts/unexpected.md'), 'Unexpected prompt');
    assert.throws(() => f.run(), /Unexpected generated resource files/);
    assert.equal(await readFile(join(f.directory, 'prompts/unexpected.md'), 'utf8'), 'Unexpected prompt');
  } finally { await f.close(); }
});

test('resource checks reject prompt drift and missing package discovery before generation writes', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'prompts/bro.md');
    await writeFile(target, 'Changed prompt');
    assert.throws(() => f.run(), /Generated resource drift: prompts\/bro.md/);
    const manifestPath = join(f.directory, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, pi: { ...manifest.pi, prompts: [] } }));
    assert.throws(() => f.run('--write'), /Package must register and distribute/);
    assert.equal(await readFile(target, 'utf8'), 'Changed prompt');
  } finally { await f.close(); }
});

test('a changed kit source prevents all generation writes', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'prompts/bro.md');
    await writeFile(target, 'Existing generated sentinel');
    await writeFile(join(f.directory, 'upstream-team-kit/skills/deslop/SKILL.md'), 'Changed source');
    assert.throws(() => f.run('--write'), /Upstream hash mismatch: upstream-team-kit\/skills\/deslop\/SKILL.md/);
    assert.equal(await readFile(target, 'utf8'), 'Existing generated sentinel');
  } finally { await f.close(); }
});

test('overlapping source destinations fail before changing generated skills', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'prompts/bro.md');
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
