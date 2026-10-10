import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, onTestFinished, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const checkoutSrc = realpathSync(join(packageRoot, 'src'));

const EXPECTED_FORMATS = [
  'whole',
  'diff',
  'diff-fenced',
  'udiff',
  'udiff-simple',
  'patch',
  'ask',
  'architect',
  'context',
  'editor-diff',
  'editor-diff-fenced',
  'editor-whole',
] as const;

const PEERS = [
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-tui',
  'typebox',
  'diff-match-patch',
  'ignore',
  'yaml',
] as const;

function linkDependency(name: string, fromRoot: string, intoModules: string): void {
  const source = join(fromRoot, 'node_modules', name);
  const target = join(intoModules, name);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(realpathSync(source), target, 'dir');
}

test('isolated package load registers every edit format and packaged resources', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'pi-maintainer-complete-runtime-'));
  onTestFinished(() => rmSync(staging, { recursive: true, force: true }));

  execFileSync('bun', ['pm', 'pack', '--destination', staging, '--ignore-scripts'], { cwd: packageRoot, stdio: 'pipe' });
  const tarball = readdirSync(staging).find((name) => name.endsWith('.tgz'));
  expect(tarball).toBeDefined();

  const extractRoot = join(staging, 'extract');
  mkdirSync(extractRoot);
  execFileSync('tar', ['-xzf', join(staging, tarball!), '-C', extractRoot], { stdio: 'pipe' });
  const packed = realpathSync(join(extractRoot, 'package'));
  expect(packed).not.toBe(realpathSync(packageRoot));
  expect(realpathSync(join(packed, 'src'))).not.toBe(checkoutSrc);

  const modules = join(packed, 'node_modules');
  mkdirSync(modules, { recursive: true });
  for (const name of PEERS) linkDependency(name, packageRoot, modules);

  const featureUrl = pathToFileURL(join(packed, 'src/edit/feature.ts')).href;
  const policyUrl = pathToFileURL(join(packed, 'src/edit/model-format-policy.ts')).href;
  const indexUrl = pathToFileURL(join(packed, 'src/index.ts')).href;
  expect(featureUrl).toContain(packed);
  expect(policyUrl).toContain(packed);

  const featureModule = await import(featureUrl);
  const policyModule = await import(policyUrl);
  const indexModule = await import(indexUrl);
  expect(typeof indexModule.default).toBe('function');

  const formats = featureModule.editFeature.create({
    settings: { value: (option: { defaultValue: unknown }) => option.defaultValue, source: () => 'default' },
    host: {
      output() {},
      warning() {},
      error() {},
      confirm: async () => true,
      select: async () => undefined,
      exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    },
    cwd: packed,
  }).formats as Map<string, { withPlan: unknown; prompts: string }>;

  expect([...formats.keys()].sort()).toEqual([...EXPECTED_FORMATS].sort());
  for (const name of EXPECTED_FORMATS) {
    const format = formats.get(name);
    expect(format, name).toBeDefined();
    expect(typeof format!.withPlan).toBe('function');
    expect(typeof format!.prompts).toBe('string');
  }

  const promptFiles = readdirSync(join(packed, 'src/edit/prompts')).filter((name) => name.endsWith('.ts'));
  expect(promptFiles).toEqual(
    expect.arrayContaining([
      'architect.ts',
      'ask.ts',
      'context.ts',
      'editblock-fenced.ts',
      'editblock.ts',
      'editor-diff-fenced.ts',
      'editor-editblock.ts',
      'editor-whole.ts',
      'patch.ts',
      'udiff-simple.ts',
      'udiff.ts',
      'wholefile.ts',
    ]),
  );
  for (const file of promptFiles) {
    const url = pathToFileURL(join(packed, 'src/edit/prompts', file)).href;
    expect(url).toContain(packed);
    const loaded = await import(url);
    expect(Object.keys(loaded).length).toBeGreaterThan(0);
  }

  const policy = policyModule.resolveModelFormatPolicy('gpt-4o');
  expect(policy.editFormat).toBe('diff');
  expect(policy.editorEditFormat).toBe('editor-diff');
  expect(policy.reminder).toBe('sys');
});
