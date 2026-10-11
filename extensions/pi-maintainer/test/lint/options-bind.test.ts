import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { lintFeature } from '../../src/lint/feature.ts';
import { lintOptionList, lintOptions } from '../../src/lint/options.ts';
import { loadSettings } from '../../src/settings/load.ts';

async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('automatic lint defaults on and automatic tests default off', async () => {
  const loaded = await loadSettings({
    specs: lintOptionList,
    getFlag: () => undefined,
    processEnvironment: {},
    cwd: await tempDir('lint-opt-def-'),
    home: await tempDir('lint-opt-home-'),
  });
  expect(loaded.settings.value(lintOptions.autoLint)).toBe(true);
  expect(loaded.settings.value(lintOptions.autoTest)).toBe(false);
  expect(lintFeature.options).toEqual(expect.arrayContaining([lintOptions.autoLint, lintOptions.autoTest]));
});

test('cli and config can disable auto-lint and enable auto-test', async () => {
  const cwd = await tempDir('lint-opt-cwd-');
  await writeFile(join(cwd, '.pi-maintainer.conf.yml'), 'auto-lint: false\nauto-test: true\n');
  const loaded = await loadSettings({
    specs: lintOptionList,
    getFlag: () => undefined,
    processEnvironment: {},
    cwd,
    home: await tempDir('lint-opt-home2-'),
  });
  expect(loaded.settings.value(lintOptions.autoLint)).toBe(false);
  expect(loaded.settings.value(lintOptions.autoTest)).toBe(true);
});
