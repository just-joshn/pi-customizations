import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Host } from '../../src/core/host.ts';
import { disabledGitPolicy } from '../../src/feature.ts';
import { addFiles, dropAll, dropMatches, readOnlyFiles, saveSelectionCommands, type SelectionEnv, type SelectionState } from '../../src/edit/selection.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';

async function harness() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'selection-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const outputs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const host: Host = {
    output: (text) => {
      outputs.push(text);
    },
    error: (text) => {
      errors.push(text);
    },
    warning: (text) => {
      warnings.push(text);
    },
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const tree = createWorkingTree({ notices: host });
  const env: SelectionEnv = { root, host, tree, git: disabledGitPolicy, autoCommits: true, supportsImages: true };
  const empty: SelectionState = { editable: [], readOnly: [], originalReadOnly: [] };
  return { root, host, env, empty, outputs, errors, warnings };
}

test(
  'add accepts literal relative and absolute files',
  { meta: { aider: ['test_commands/TestCommands.test_cmd_add', 'test_commands/TestCommands.test_cmd_add_abs_filename'] } },
  async () => {
    const h = await harness();
    await writeFile(join(h.root, 'a.txt'), 'a\n');
    await writeFile(join(h.root, 'b.txt'), 'b\n');
    const abs = join(h.root, 'b.txt');
    const next = await addFiles(`a.txt ${abs}`, h.empty, h.env);
    expect(next.editable).toEqual([join(h.root, 'a.txt'), abs]);
    expect(h.outputs).toEqual(expect.arrayContaining([expect.stringContaining('Added a.txt'), expect.stringContaining('Added b.txt')]));
  },
);

test(
  'add expands a quoted filename with spaces',
  { meta: { aider: ['test_commands/TestCommands.test_cmd_add_quoted_filename', 'test_commands/TestCommands.test_cmd_add_filename_with_special_chars'] } },
  async () => {
    const h = await harness();
    await writeFile(join(h.root, 'file with spaces.py'), 'x\n');
    const next = await addFiles('"file with spaces.py"', h.empty, h.env);
    expect(next.editable).toEqual([join(h.root, 'file with spaces.py')]);
  },
);

test('add creates an unmatched non-wildcard path after confirmation', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_no_match_but_make_it'] } }, async () => {
  const h = await harness();
  const next = await addFiles('nested/new.txt', h.empty, h.env);
  expect(next.editable).toEqual([join(h.root, 'nested/new.txt')]);
  expect(await readFile(join(h.root, 'nested/new.txt'), 'utf8')).toBe('');
});

test('add refuses wildcard creation when nothing matches', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_no_match', 'test_commands/TestCommands.test_cmd_add_bad_glob'] } }, async () => {
  const h = await harness();
  const next = await addFiles('missing*.txt', h.empty, h.env);
  expect(next.editable).toEqual([]);
  expect(h.errors.some((text) => text.includes('cannot create file with wildcard'))).toBe(true);
});

test(
  'add expands a directory glob under the root',
  {
    meta: {
      aider: ['test_commands/TestCommands.test_cmd_add_with_glob_patterns', 'test_commands/TestCommands.test_cmd_add_drop_directory', 'test_commands/TestCommands.test_cmd_add_dirname_with_special_chars'],
    },
  },
  async () => {
    const h = await harness();
    await mkdir(join(h.root, 'pkg'));
    await writeFile(join(h.root, 'pkg/one.py'), '1\n');
    await writeFile(join(h.root, 'pkg/two.py'), '2\n');
    const next = await addFiles('pkg/*.py', h.empty, h.env);
    expect([...next.editable].sort()).toEqual([join(h.root, 'pkg/one.py'), join(h.root, 'pkg/two.py')].sort());
  },
);

test('add refuses a non-image path outside the root when auto-commits are on', { meta: { aider: ['test_commands/TestCommands.test_cmd_add_from_outside_root'] } }, async () => {
  const h = await harness();
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'outside-')));
  onTestFinished(() => rm(outside, { recursive: true, force: true }));
  const file = join(outside, 'ext.txt');
  await writeFile(file, 'x\n');
  const next = await addFiles(file, h.empty, h.env);
  expect(next.editable).toEqual([]);
  expect(h.errors.some((text) => text.includes('which is not within'))).toBe(true);
});

test(
  'bare drop keeps originally supplied read-only files',
  { meta: { aider: ['test_commands/TestCommands.test_drop_with_original_read_only_files', 'test_commands/TestCommands.test_drop_with_no_original_read_only_files', 'test_commands/TestCommands.test_reset_with_no_original_read_only_files', 'test_commands/TestCommands.test_reset_after_coder_clone_preserves_original_read_only_files', 'test_commands/TestCommands.test_drop_bare_after_coder_clone_preserves_original_read_only_files'] } },
  async () => {
    const h = await harness();
    const kept = join(h.root, 'kept.txt');
    const later = join(h.root, 'later.txt');
    const state: SelectionState = {
      editable: [join(h.root, 'edit.txt')],
      readOnly: [kept, later],
      originalReadOnly: [kept],
    };
    expect(dropAll(state, h.root)).toEqual({ editable: [], readOnly: [kept], originalReadOnly: [kept] });
    expect(dropAll({ editable: [kept], readOnly: [later], originalReadOnly: [] }, h.root)).toEqual({
      editable: [],
      readOnly: [],
      originalReadOnly: [],
    });
  },
);

test(
  'drop removes matching editable and read-only paths',
  {
    meta: {
      aider: ['test_commands/TestCommands.test_cmd_drop_without_glob', 'test_commands/TestCommands.test_cmd_drop_with_glob_patterns', 'test_commands/TestCommands.test_cmd_add_drop_directory', 'test_commands/TestCommands.test_cmd_read_only', 'test_commands/TestCommands.test_cmd_read_only_with_external_file', 'test_commands/TestCommands.test_cmd_drop_read_only_with_relative_path', 'test_commands/TestCommands.test_cmd_read_only_with_multiple_files', 'test_commands/TestCommands.test_cmd_read_only_with_tilde_path', 'test_commands/TestCommands.test_cmd_read_only_with_square_brackets', 'test_commands/TestCommands.test_drop_specific_original_read_only_file'],
    },
  },
  async () => {
    const h = await harness();
    const a = join(h.root, 'a.txt');
    const b = join(h.root, 'b.txt');
    const state: SelectionState = { editable: [a], readOnly: [b], originalReadOnly: [] };
    const next = await dropMatches('a.txt b.txt', state, h.env);
    expect(next.editable).toEqual([]);
    expect(next.readOnly).toEqual([]);
  },
);

test('read-only converts editable files when bare', { meta: { aider: ['test_commands/TestCommands.test_cmd_read_only_bulk_conversion'] } }, async () => {
  const h = await harness();
  const a = join(h.root, 'a.txt');
  const state: SelectionState = { editable: [a], readOnly: [], originalReadOnly: [] };
  const next = await readOnlyFiles('', state, h.env);
  expect(next).toEqual({ editable: [], readOnly: [a], originalReadOnly: [] });
});

test(
  'read-only accepts a literal external path',
  {
    meta: {
      aider: ['test_commands/TestCommands.test_cmd_read_only_with_external_file', 'test_commands/TestCommands.test_cmd_read_only', 'test_commands/TestCommands.test_cmd_read_only_with_multiple_files', 'test_commands/TestCommands.test_cmd_read_only_with_tilde_path', 'test_commands/TestCommands.test_cmd_read_only_with_square_brackets', 'test_commands/TestCommands.test_cmd_read_only_with_glob_pattern', 'test_commands/TestCommands.test_cmd_read_only_with_recursive_glob', 'test_commands/TestCommands.test_cmd_read_only_with_nonexistent_glob', 'test_main/TestMain.test_read_option', 'test_main/TestMain.test_read_option_with_external_file', 'test_commands/TestCommands.test_cmd_save_and_load_with_external_file', 'test_commands/TestCommands.test_cmd_save_and_load_with_multiple_external_files'],
    },
  },
  async () => {
    const h = await harness();
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'ro-')));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    const file = join(outside, 'ref.txt');
    await writeFile(file, 'ref\n');
    const next = await readOnlyFiles(file, h.empty, h.env);
    expect(next.readOnly).toEqual([file]);
  },
);

test('read-only refuses images when vision is unsupported', { meta: { aider: ['test_commands/TestCommands.test_cmd_read_only_with_image_file'] } }, async () => {
  const h = await harness();
  const env = { ...h.env, supportsImages: false };
  await writeFile(join(h.root, 'shot.png'), 'fake');
  const next = await readOnlyFiles('shot.png', h.empty, env);
  expect(next.readOnly).toEqual([]);
  expect(h.errors.some((text) => text.includes('does not support images'))).toBe(true);
});

test(
  'save writes reconstruction commands with relative and absolute paths',
  {
    meta: {
      aider: ['test_commands/TestCommands.test_cmd_save_and_load', 'test_commands/TestCommands.test_cmd_save_and_load_with_external_file', 'test_commands/TestCommands.test_cmd_save_and_load_with_multiple_external_files'],
    },
  },
  async () => {
    const h = await harness();
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'save-')));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    const external = join(outside, 'ext.txt');
    const state: SelectionState = {
      editable: [join(h.root, 'a.txt')],
      readOnly: [join(h.root, 'b.txt'), external],
      originalReadOnly: [],
    };
    expect(saveSelectionCommands(state, h.root)).toEqual([
      '/drop',
      '/add       a.txt',
      ...[join(h.root, 'b.txt'), external].sort().map((path) => (path.startsWith(h.root) ? `/read-only ${path.slice(h.root.length + 1)}` : `/read-only ${path}`)),
    ]);
  },
);
