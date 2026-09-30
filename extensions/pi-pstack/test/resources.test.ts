import { execFileSync } from 'node:child_process';
import fs, { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, vi } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-resources-'));
  try {
    await mkdir(join(directory, 'docs'));
    await mkdir(join(directory, 'scripts'));
    for (const path of ['upstream', 'upstream-team-kit', 'skills', 'prompts', 'package.json', 'scripts/resources.mjs', 'docs/source-inventory.json', 'docs/team-kit-source-inventory.json', 'docs/resource-map.json'])
      await cp(join(root, path), join(directory, path), { recursive: true, filter: (source) => !source.split('/').includes('node_modules') });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    run: (...args: string[]) => execFileSync(process.execPath, [join(directory, 'scripts/resources.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' }),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test('resource fixture copy failure removes the partially populated directory', async () => {
  let directory = '';
  const failing = vi.spyOn(fs, 'cp').mockImplementation(async (_source: unknown, destination: unknown) => {
    directory = dirname(String(destination));
    throw new Error('copy failed');
  });
  syncBuiltinESMExports();
  try {
    await expect(fixture()).rejects.toThrow(/copy failed/);
    expect(directory).toMatch(/pstack-resources-/);
    await expect(access(directory)).rejects.toThrow(/ENOENT/);
  } finally {
    failing.mockRestore();
    syncBuiltinESMExports();
  }
});

test('resource generation is reproducible across both source bundles', async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.directory, 'docs/resource-map.json'));
    expect(f.run('--write')).toMatch(/187 upstream files and 205 generated resources/);
    expect(await readFile(join(f.directory, 'docs/resource-map.json'))).toEqual(before);
    expect(f.run()).toMatch(/187 upstream files and 205 generated resources/);
  } finally {
    await f.close();
  }
});

test('generation separates reusable prompts from procedural skills and Reference metadata', async () => {
  const f = await fixture();
  try {
    f.run('--write');
    expect((await readdir(join(f.directory, 'prompts'))).length).toBe(63);
    expect((await readdir(join(f.directory, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length).toBe(64);
    await expect(readFile(join(f.directory, 'skills/bro/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(f.directory, 'prompts/bro.md'), 'utf8')).toMatch(/Restate your last message/);
    expect(await readFile(join(f.directory, 'prompts/architect.md'), 'utf8')).toMatch(/architect\/SKILL\.md/);
    expect(await readFile(join(f.directory, 'prompts/architect.md'), 'utf8')).toMatch(/\$ARGUMENTS/);
    await expect(readFile(join(f.directory, 'prompts/poteto-mode.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(f.directory, 'prompts/setup-pstack.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const name of ['poteto-mode', 'typescript-best-practices']) {
      const text = await readFile(join(f.directory, `skills/${name}/SKILL.md`), 'utf8');
      expect(text).not.toMatch(/^(mode|icon|color|reminder|paths):/m);
    }
  } finally {
    await f.close();
  }
});

test('generation migrates the former bro skill without deleting unrelated resources', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.directory, 'skills/bro'));
    await cp(join(f.directory, 'upstream/skills/bro/SKILL.md'), join(f.directory, 'skills/bro/SKILL.md'));
    f.run('--write');
    await expect(readFile(join(f.directory, 'skills/bro/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(f.directory, 'prompts/bro.md'), 'utf8')).toMatch(/Restate your last message/);
    await writeFile(join(f.directory, 'prompts/unexpected.md'), 'Unexpected prompt');
    expect(() => f.run()).toThrow(/Unexpected generated resource files/);
    expect(await readFile(join(f.directory, 'prompts/unexpected.md'), 'utf8')).toBe('Unexpected prompt');
  } finally {
    await f.close();
  }
});

test('resource checks reject prompt drift and missing package discovery before generation writes', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'prompts/bro.md');
    await writeFile(target, 'Changed prompt');
    expect(() => f.run()).toThrow(/Generated resource drift: prompts\/bro.md/);
    const manifestPath = join(f.directory, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, pi: { ...manifest.pi, prompts: [] } }));
    expect(() => f.run('--write')).toThrow(/Package must register and distribute/);
    expect(await readFile(target, 'utf8')).toBe('Changed prompt');
  } finally {
    await f.close();
  }
});

test('a changed kit source prevents all generation writes', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'prompts/bro.md');
    await writeFile(target, 'Existing generated sentinel');
    await writeFile(join(f.directory, 'upstream-team-kit/skills/deslop/SKILL.md'), 'Changed source');
    expect(() => f.run('--write')).toThrow(/Upstream hash mismatch: upstream-team-kit\/skills\/deslop\/SKILL.md/);
    expect(await readFile(target, 'utf8')).toBe('Existing generated sentinel');
  } finally {
    await f.close();
  }
});

test('overlapping source destinations fail before changing generated skills', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'prompts/bro.md');
    await writeFile(target, 'Existing generated sentinel');
    const script = join(f.directory, 'scripts/resources.mjs');
    const original = await readFile(script, 'utf8');
    await writeFile(script, original.replace("{ directory: 'upstream-team-kit', inventory: 'docs/team-kit-source-inventory.json' }", "{ directory: 'upstream', inventory: 'docs/source-inventory.json' }"));
    expect(() => f.run('--write')).toThrow(/Duplicate generated skill destination across source bundles/);
    expect(await readFile(target, 'utf8')).toBe('Existing generated sentinel');
  } finally {
    await f.close();
  }
});
