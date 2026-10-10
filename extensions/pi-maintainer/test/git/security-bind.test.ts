import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { absRootPath, getRelFname, safeAbsPath } from '../../src/core/chat-files.ts';
import type { Host } from '../../src/core/host.ts';
import { disabledGitPolicy } from '../../src/feature.ts';
import { addFiles, type SelectionEnv, type SelectionState } from '../../src/edit/selection.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';

test(
  'path helpers resolve symlinks while getRelFname still accepts paths outside the root',
  { meta: { evidence: ['ev-git/probe/symlink-path-resolution'] } },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'git-path-trust-')));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'git-path-out-')));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    await mkdir(join(root, 'inside'), { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'secret\n');
    await symlink(outside, join(root, 'link'));
    const resolved = absRootPath(root, 'link/secret.txt');
    expect(resolved).toBe(join(outside, 'secret.txt'));
    expect(safeAbsPath(join(root, 'link'))).toBe(outside);
    expect(getRelFname(root, join(outside, 'secret.txt')).includes('..')).toBe(true);
  },
);

test(
  '/add outside-root refusal stays conditional on automatic commits for non-image files',
  { meta: { aider: ['test_commands/TestCommands.test_cmd_add_from_outside_root'] } },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'git-path-add-')));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'git-path-add-out-')));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    const errors: string[] = [];
    const host: Host = {
      output: () => {},
      warning: () => {},
      error: (text) => {
        errors.push(text);
      },
      confirm: async () => true,
      select: async () => undefined,
      exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    };
    const file = join(outside, 'ext.txt');
    await writeFile(file, 'x\n');
    const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };
    const base: SelectionEnv = {
      root,
      host,
      tree: createWorkingTree({ notices: host }),
      git: { ...disabledGitPolicy, repoRoot: () => root, trackedFiles: async () => [] },
      autoCommits: true,
      supportsImages: true,
    };
    const refused = await addFiles(file, empty, base);
    expect(refused.editable).toEqual([]);
    expect(errors).toEqual([`Can not add ${file}, which is not within ${root}`]);
    errors.length = 0;
    const admitted = await addFiles(file, empty, { ...base, autoCommits: false });
    expect(admitted.editable).toEqual([file]);
    expect(errors).toEqual([]);
  },
);
