import { expect, test } from 'vitest';
import { createPorts } from '../../src/feature.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { gitFeature, gitOptions } from '../../src/git/feature.ts';
import type { ResolvedSettings } from '../../src/settings/spec.ts';

test('gitFeature installs beside edit and exposes a real GitPolicy when a repo exists', async () => {
  const { initRepo, recordingHost, tempDir } = await import('./support.ts');
  const root = await tempDir('git-feature-');
  await initRepo(root);
  const host = recordingHost();
  const settings: ResolvedSettings = {
    value: (option) => option.defaultValue,
    source: () => 'default',
  };
  const ports = createPorts([editFeature, gitFeature], { settings, host, cwd: root });
  expect(ports.git.repoRoot()).toBe(root);
  expect(await ports.git.trackedFiles()).toEqual([]);
  expect(gitFeature.options).toContain(gitOptions.autoCommits);
  expect(gitFeature.name).toBe('git');
});

test('installMaintainer wiring lists gitFeature after editFeature', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'));
  expect(source).toContain('gitFeature');
  expect(source).toContain('installMaintainer(pi, [editFeature, gitFeature, mapFeature])');
});
