import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repository = join(root, '../..');
const scratch = await mkdtemp(join(tmpdir(), 'vendor-regression-'));
try {
  execFileSync('git', ['init', '--quiet', scratch]);
  const fixture = join(scratch, 'extensions/pi-antigravity-oauth');
  await mkdir(join(fixture, 'scripts'), { recursive: true });
  await mkdir(join(fixture, 'src/pi-ai'), { recursive: true });
  await writeFile(join(fixture, 'package.json'), await readFile(join(root, 'package.json')));
  await symlink(join(root, 'node_modules'), join(fixture, 'node_modules'));
  await symlink(join(repository, 'node_modules'), join(scratch, 'node_modules'));
  await writeFile(join(scratch, 'biome.json'), await readFile(join(repository, 'biome.json')));
  await writeFile(join(scratch, '.gitignore'), '');
  await writeFile(join(scratch, 'package.json'), await readFile(join(repository, 'package.json')));
  for (const name of ['vendor-pi-ai.mjs', 'vendor-strict.patch']) {
    await writeFile(join(fixture, 'scripts', name), await readFile(join(root, 'scripts', name)));
  }
  const generator = join(fixture, 'scripts/vendor-pi-ai.mjs');
  const generate = (...args) => execFileSync(process.execPath, [generator, ...args], { encoding: 'utf8', stdio: 'pipe' });
  generate();
  const files = await readdir(join(fixture, 'src/pi-ai'));
  assert.equal(files.length, 9);
  for (const name of files) {
    const content = await readFile(join(fixture, 'src/pi-ai', name), 'utf8');
    const checked = execFileSync(join(repository, 'node_modules/.bin/biome'), ['check', '--write', '--error-on-warnings', '--config-path', join(repository, 'biome.json'), '--stdin-file-path', join(root, 'src/pi-ai', name)], {
      cwd: repository,
      input: content,
      encoding: 'utf8',
    });
    assert.equal(checked, content, `${name} already satisfies shared Biome`);
  }
  const snapshot = await Promise.all(files.map((name) => readFile(join(fixture, 'src/pi-ai', name), 'utf8')));
  generate('--check');
  generate();
  assert.deepEqual(await Promise.all(files.map((name) => readFile(join(fixture, 'src/pi-ai', name), 'utf8'))), snapshot);
  const drift = join(fixture, 'src/pi-ai', 'genai.ts');
  await writeFile(drift, 'deliberate drift\n');
  assert.throws(() => generate('--check'));
  assert.equal(await readFile(drift, 'utf8'), 'deliberate drift\n');
  const patchPath = join(fixture, 'scripts/vendor-strict.patch');
  const patch = await readFile(patchPath, 'utf8');
  await writeFile(patchPath, patch.replaceAll('src/pi-ai/constrained-sampling.ts', 'src/pi-ai/unexpected.ts'));
  assert.throws(() => generate(), /Unexpected vendor patch entry/);
  assert.equal(await readFile(drift, 'utf8'), 'deliberate drift\n');
  await writeFile(patchPath, 'invalid patch\n');
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('pi-ai-vendor-')).sort();
  assert.throws(() => generate());
  assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith('pi-ai-vendor-')).sort(), before);
  assert.equal(await readFile(drift, 'utf8'), 'deliberate drift\n');
  process.stdout.write('Vendor outputs satisfy shared Biome, reproduce exactly, reject drift read-only, and clean up failed patch application.\n');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
