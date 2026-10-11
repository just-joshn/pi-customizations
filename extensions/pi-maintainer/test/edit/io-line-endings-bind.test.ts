import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { editFeature } from '../../src/edit/feature.ts';
import { editOptionList } from '../../src/edit/options.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { loadSettings } from '../../src/settings/load.ts';

const notices = { output: () => {}, warning: () => {}, error: () => {} };
const host = {
  ...notices,
  confirm: async () => true,
  select: async () => undefined,
  exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
};

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-io-line-endings-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const cwd = join(root, 'cwd');
  for (const dir of [home, cwd]) await mkdir(dir, { recursive: true });
  return { home, cwd };
}

const endings = [
  { value: 'lf', expected: 'a\nb\n' },
  { value: 'crlf', expected: 'a\r\nb\r\n' },
  { value: 'platform', expected: process.platform === 'win32' ? 'a\r\nb\r\n' : 'a\nb\n' },
] as const;

test.for(endings)(
  'settings line-endings=$value writes that newline through the edit working tree',
  {
    meta: { aider: ['test_io/TestInputOutput.test_line_endings_validation'] },
  },
  async ({ value, expected }) => {
    const { home, cwd } = await workspace();
    const loaded = await loadSettings({
      specs: editOptionList,
      getFlag: (name) => (name === 'line-endings' ? value : undefined),
      processEnvironment: {},
      cwd,
      home,
    });
    const ports = editFeature.create({ settings: loaded.settings, cwd, host });
    const path = join(cwd, 'out.txt');
    await ports.tree.write(path, 'a\nb\n');
    expect(await readFile(path, 'utf8')).toBe(expected);
  },
);

test('invalid line-endings fails with Aider Invalid line_endings value message', {
  meta: { aider: ['test_io/TestInputOutput.test_line_endings_validation'] },
}, () => {
  expect(() => createWorkingTree({ lineEndings: 'invalid', notices })).toThrow('Invalid line_endings value: invalid. Must be one of: platform, lf, crlf');
});
