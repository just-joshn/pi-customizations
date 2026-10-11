import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { maintainerExtension } from '../support/maintainer.ts';
import { piSessionFixture, scriptedModel } from '../support/pi-session.ts';

test('/add registers an editable file through pi.registerCommand', { meta: { aider: ['test_commands/TestCommands.test_cmd_add'] } }, async () => {
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'edit-format: whole\nyes-always: true\n' });
  await writeFile(join(f.cwd, 'notes.txt'), 'hello\n');
  const session = await f.open();
  await session.prompt('/add notes.txt');
  expect(restore(session.sessionManager.getBranch()).snapshot?.files.editable).toEqual([join(f.cwd, 'notes.txt')]);
  expect(f.errors).toEqual([]);
});

test('/ask with text runs one no-edit exchange then returns to the prior mode', { meta: { aider: ['test_commands/TestCommands.test_cmd_ask'] } }, async () => {
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'edit-format: whole\nfile: [notes.txt]\nyes-always: true\n' });
  await writeFile(join(f.cwd, 'notes.txt'), 'before\n');
  f.replies.push({ text: 'notes.txt\n```\nafter\n```\n' });
  const session = await f.open();
  expect(restore(session.sessionManager.getBranch()).snapshot?.mode).toBe('whole');
  await session.prompt('/ask what does notes say?');
  await session.waitForIdle();
  expect(await readFile(join(f.cwd, 'notes.txt'), 'utf8')).toBe('before\n');
  expect(f.requests).toHaveLength(1);
  expect(restore(session.sessionManager.getBranch()).snapshot).toMatchObject({ mode: 'whole', returnMode: null });
  expect(f.errors).toEqual([]);
});

test('/reset drops files and advances historyThrough', { meta: { aider: ['test_commands/TestCommands.test_cmd_reset', 'test_commands/TestCommands.test_reset_with_original_read_only_files'] } }, async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    config: 'edit-format: whole\nfile: [edit.txt]\nread: [keep.txt]\nyes-always: true\n',
  });
  await writeFile(join(f.cwd, 'edit.txt'), 'e\n');
  await writeFile(join(f.cwd, 'keep.txt'), 'k\n');
  f.replies.push({ text: 'ok' });
  const session = await f.open();
  await session.prompt('hello');
  await session.waitForIdle();
  await session.prompt('/reset');
  const snapshot = restore(session.sessionManager.getBranch()).snapshot;
  expect(snapshot?.files.editable).toEqual([]);
  expect(snapshot?.files.readOnly).toEqual([join(f.cwd, 'keep.txt')]);
  expect(snapshot?.historyThrough).not.toBeNull();
  expect(f.errors).toEqual([]);
});

test('/drop clears editable files while keeping original read-only files', {
  meta: { aider: ['test_commands/TestCommands.test_drop_with_original_read_only_files', 'test_commands/TestCommands.test_drop_with_no_original_read_only_files'] },
}, async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    config: 'edit-format: whole\nfile: [edit.txt]\nread: [keep.txt]\nyes-always: true\n',
  });
  await writeFile(join(f.cwd, 'edit.txt'), 'e\n');
  await writeFile(join(f.cwd, 'keep.txt'), 'k\n');
  const session = await f.open();
  await session.prompt('/drop');
  const snapshot = restore(session.sessionManager.getBranch()).snapshot;
  expect(snapshot?.files.editable).toEqual([]);
  expect(snapshot?.files.readOnly).toEqual([join(f.cwd, 'keep.txt')]);
  expect(f.errors).toEqual([]);
});

test('/load skips interactive mode-switch commands and continues', { meta: { aider: ['test_commands/TestCommands.test_cmd_load_with_switch_coder'] } }, async () => {
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'edit-format: whole\nyes-always: true\n' });
  const loadPath = join(f.cwd, 'cmds.txt');
  await writeFile(join(f.cwd, 'keep.txt'), 'k\n');
  await writeFile(loadPath, '/ask should skip\n/add keep.txt\n');
  const session = await f.open();
  await session.prompt(`/load ${loadPath}`);
  expect(restore(session.sessionManager.getBranch()).snapshot?.files.editable).toEqual([join(f.cwd, 'keep.txt')]);
  expect(f.errors).toEqual([]);
});

test('/save and /load reconstruct editable and read-only selections', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_save_and_load', 'test_commands/TestCommands.test_cmd_save_and_load_with_external_file', 'test_commands/TestCommands.test_cmd_save_and_load_with_multiple_external_files'],
  },
}, async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    config: 'edit-format: whole\nfile: [a.txt]\nread: [b.txt]\nyes-always: true\n',
  });
  await writeFile(join(f.cwd, 'a.txt'), 'a\n');
  await writeFile(join(f.cwd, 'b.txt'), 'b\n');
  const session = await f.open();
  const savePath = join(f.cwd, 'selection.txt');
  await session.prompt(`/save ${savePath}`);
  expect(await readFile(savePath, 'utf8')).toContain('/add       a.txt');
  expect(await readFile(savePath, 'utf8')).toContain('/read-only b.txt');
  await session.prompt('/drop');
  await session.prompt(`/load ${savePath}`);
  const snapshot = restore(session.sessionManager.getBranch()).snapshot;
  expect(snapshot?.files.editable).toEqual([join(f.cwd, 'a.txt')]);
  expect(snapshot?.files.readOnly).toEqual([join(f.cwd, 'b.txt')]);
  expect(f.errors).toEqual([]);
});

test('/model and /editor-model persist role selections for the next reconstruction', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_model', 'test_commands/TestCommands.test_cmd_editor_model', 'test_commands/TestCommands.test_cmd_model_preserves_explicit_edit_format'],
  },
}, async () => {
  const other = { ...scriptedModel, id: 'other-scripted', name: 'Other scripted' };
  const editor = { ...scriptedModel, id: 'editor-scripted', name: 'Editor scripted' };
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    models: [other, editor],
    config: 'edit-format: udiff\nyes-always: true\n',
  });
  const session = await f.open();
  await session.prompt('/editor-model editor-scripted');
  let snapshot = restore(session.sessionManager.getBranch()).snapshot;
  expect(snapshot?.physicalModel).toEqual({ provider: 'maintainer-test', id: 'scripted' });
  expect(snapshot?.editorModel).toEqual({ provider: 'maintainer-test', id: 'editor-scripted' });
  await session.setModel(other);
  snapshot = restore(session.sessionManager.getBranch()).snapshot;
  expect(snapshot?.physicalModel).toEqual({ provider: 'maintainer-test', id: 'other-scripted' });
  expect(snapshot?.editorModel).toEqual({ provider: 'maintainer-test', id: 'editor-scripted' });
  expect(snapshot?.mode).toBe('udiff');
  expect(f.errors).toEqual([]);
});
