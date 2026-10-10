#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { missingWorkspaceDeps } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'check-workspace-deps.mjs')).href);

async function fixture(packages) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-deps-'));
  for (const [name, body] of Object.entries(packages)) {
    const packageDir = join(directory, 'extensions', name);
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify(body, null, 2));
  }
  return directory;
}

const clean = await fixture({
  'no-deps': { name: 'no-deps', private: true },
});
try {
  assert.deepEqual(missingWorkspaceDeps(clean), []);
} finally {
  await rm(clean, { recursive: true, force: true });
}

const broken = await fixture({
  'needs-yaml': { name: 'needs-yaml', private: true, dependencies: { yaml: '2.9.0' } },
});
try {
  const missing = missingWorkspaceDeps(broken);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.dependency, 'yaml');
  assert.equal(missing[0]?.package, 'needs-yaml');
} finally {
  await rm(broken, { recursive: true, force: true });
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let yamlRoot;
try {
  yamlRoot = dirname(createRequire(join(repoRoot, 'extensions/pi-maintainer/package.json')).resolve('yaml'));
} catch {
  yamlRoot = null;
}

if (yamlRoot) {
  const linked = await fixture({
    'has-yaml': { name: 'has-yaml', private: true, dependencies: { yaml: '2.9.0' } },
  });
  try {
    const packageDir = join(linked, 'extensions', 'has-yaml');
    await mkdir(join(packageDir, 'node_modules'), { recursive: true });
    await symlink(yamlRoot, join(packageDir, 'node_modules', 'yaml'));
    assert.deepEqual(missingWorkspaceDeps(linked), []);
  } finally {
    await rm(linked, { recursive: true, force: true });
  }
}

process.stdout.write('check-workspace-deps.selftest: ok\n');
