import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { restore } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { selectEditFormat, transferModeSelection, UnknownEditFormat } from '../../src/edit/factory.ts';
import { diffFencedFormat, diffFormat, editFeature, udiffEditFormat, udiffSimpleFormat, wholeFileFormat } from '../../src/edit/feature.ts';
import { editorDiffFencedFormat, editorDiffFormat, editorWholeFormat } from '../../src/edit/modes.ts';
import { editOptionList, editOptions } from '../../src/edit/options.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import type { EditContext } from '../../src/feature.ts';
import { loadSettings } from '../../src/settings/load.ts';
import type { ResolvedSettings } from '../../src/settings/spec.ts';
import { maintainerExtension } from '../support/maintainer.ts';
import { piSessionFixture } from '../support/pi-session.ts';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-factory-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const cwd = join(root, 'cwd');
  for (const dir of [home, cwd]) await mkdir(dir, { recursive: true });
  return { home, cwd };
}

function formatsFromFeature() {
  const settings: ResolvedSettings = {
    value: (option) => option.defaultValue,
    source: () => 'default',
  };
  return editFeature.create({
    settings,
    host: {
      output: () => {},
      warning: () => {},
      error: () => {},
      confirm: async () => true,
      select: async () => undefined,
      exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    },
    cwd: '/tmp',
  }).formats;
}

function snapshot(root: string, files: Snapshot['files'], ignoredMentions: string[] = []): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files,
    originalReadOnly: [...files.readOnly],
    returnMode: null,
    ignoredMentions,
    neverAsk: [],
    lastUserEntry: 'user-1',
    historyThrough: null,
    physicalModel: { provider: 'test', id: 'scripted' },
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'idle' },
  };
}

async function editContext(root: string, relative: string[]): Promise<EditContext> {
  const tree = createWorkingTree({
    notices: { output() {}, warning() {}, error() {} },
  });
  return {
    fence: ['```', '```'],
    root,
    inchatRelativeFiles: relative,
    absRootPath: (path) => absRootPath(root, path),
    tree,
    notices: { output() {}, warning() {}, error() {} },
  };
}

test('UnknownEditFormat message names the requested format and valid formats', {
  meta: { aider: ['test_coder/TestCoder.test_unknown_edit_format_exception'] },
}, () => {
  const exc = new UnknownEditFormat('invalid_format', ['diff', 'whole', 'map']);
  expect(exc).toBeInstanceOf(UnknownEditFormat);
  expect(exc.editFormat).toBe('invalid_format');
  expect(exc.validFormats).toEqual(['diff', 'whole', 'map']);
  expect(String(exc)).toBe('UnknownEditFormat: Unknown edit format invalid_format. Valid formats are: diff, whole, map');
});

test('selectEditFormat returns the registered protocol for each explicit name', {
  meta: { aider: ['test_main/TestMain.test_return_coder'] },
}, () => {
  const formats = formatsFromFeature();
  for (const name of formats.keys()) {
    expect(selectEditFormat(formats, name, { modelDefault: 'whole' }).name).toBe(name);
  }
});

test('code and null resolve to the inherited or model-default format', {
  meta: { aider: ['test_main/TestMain.test_return_coder'] },
}, () => {
  const formats = formatsFromFeature();
  expect(selectEditFormat(formats, 'code', { inherited: 'diff', modelDefault: 'whole' }).name).toBe('diff');
  expect(selectEditFormat(formats, null, { modelDefault: 'udiff' }).name).toBe('udiff');
  expect(selectEditFormat(formats, 'code', { modelDefault: 'whole' }).name).toBe('whole');
});

test('unknown edit format creation fails with the requested name and valid formats', {
  meta: { aider: ['test_coder/TestCoder.test_unknown_edit_format_creation'] },
}, () => {
  const formats = formatsFromFeature();
  try {
    selectEditFormat(formats, 'invalid_format', { modelDefault: 'whole' });
    expect.fail('expected UnknownEditFormat');
  } catch (error) {
    expect(error).toBeInstanceOf(UnknownEditFormat);
    const unknown = error as UnknownEditFormat;
    expect(unknown.editFormat).toBe('invalid_format');
    expect(unknown.validFormats).toEqual(expect.arrayContaining(['whole', 'diff', 'patch', 'ask']));
    expect(unknown.validFormats).not.toContain('replace_lines');
    expect(String(unknown)).toContain('Unknown edit format invalid_format');
    expect(String(unknown)).toContain('Valid formats are:');
  }
});

test('invalid --edit-format choice reports the requested name', {
  meta: { aider: ['test_main/TestMain.test_invalid_edit_format'] },
}, async () => {
  const { home, cwd } = await workspace();
  const loaded = await loadSettings({
    specs: editOptionList,
    getFlag: (name) => (name === 'edit-format' ? 'not-a-real-format' : undefined),
    processEnvironment: {},
    cwd,
    home,
  });
  expect(loaded.problems.some((problem) => problem.includes('invalid choice') && problem.includes('not-a-real-format'))).toBe(true);
  expect(loaded.settings.value(editOptions.editFormat)).toBe(null);
});

test('mode transfer preserves editable paths, read-only paths, and declined mentions', {
  meta: {
    aider: ['test_commands/TestCommands.test_reset_after_coder_clone_preserves_original_read_only_files', 'test_commands/TestCommands.test_drop_bare_after_coder_clone_preserves_original_read_only_files'],
  },
}, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'factory-transfer-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const editable = [join(root, 'edit.txt')];
  const readOnly = [join(root, 'keep.txt')];
  const ignoredMentions = ['noise.txt'];
  const before = snapshot(root, { editable, readOnly }, ignoredMentions);
  const after = transferModeSelection(before, 'ask');
  expect(after.mode).toBe('ask');
  expect(after.files).toEqual({ editable, readOnly });
  expect(after.ignoredMentions).toEqual(ignoredMentions);
  expect(after.originalReadOnly).toEqual(readOnly);
  expect(after.lastUserEntry).toBe('user-1');
  expect(after.physicalModel).toEqual({ provider: 'test', id: 'scripted' });
  expect(after.returnMode).toBeNull();
});

test('/ask then /code keep the chat file selection on the active exchange', {
  meta: {
    aider: ['test_commands/TestCommands.test_reset_after_coder_clone_preserves_original_read_only_files', 'test_commands/TestCommands.test_drop_bare_after_coder_clone_preserves_original_read_only_files'],
  },
}, async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    config: 'edit-format: whole\nfile: [edit.txt]\nread: [keep.txt]\nyes-always: true\n',
  });
  await writeFile(join(f.cwd, 'edit.txt'), 'e\n');
  await writeFile(join(f.cwd, 'keep.txt'), 'k\n');
  const session = await f.open();
  const before = restore(session.sessionManager.getBranch()).snapshot;
  expect(before?.mode).toBe('whole');
  await session.prompt('/ask');
  const asked = restore(session.sessionManager.getBranch()).snapshot;
  expect(asked?.mode).toBe('ask');
  expect(asked?.files).toEqual(before?.files);
  expect(asked?.ignoredMentions).toEqual(before?.ignoredMentions);
  await session.prompt('/code');
  const coded = restore(session.sessionManager.getBranch()).snapshot;
  expect(coded?.mode).toBe('whole');
  expect(coded?.files).toEqual(before?.files);
  expect(f.errors).toEqual([]);
});

test('diff-fenced, udiff-simple, and editor variants share parent apply paths with their own prompts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-variants-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'file.txt'), 'a\n');
  const context = await editContext(root, ['file.txt']);

  expect(diffFencedFormat.prompts).toBe('diff-fenced');
  expect(diffFencedFormat.name).toBe('diff-fenced');
  expect(diffFormat.prompts).toBe('diff');
  await diffFencedFormat.withPlan(
    'file.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
    context,
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toHaveLength(1);
      await plan.apply();
    },
  );
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('b\n');

  await writeFile(join(root, 'file.txt'), 'a\n');
  expect(udiffSimpleFormat.prompts).toBe('udiff-simple');
  expect(udiffEditFormat.prompts).toBe('udiff');
  await udiffSimpleFormat.withPlan(
    '```diff\n--- file.txt\n+++ file.txt\n@@\n-a\n+c\n```\n',
    context,
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toEqual(['file.txt']);
      await plan.apply();
    },
  );
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('c\n');

  await writeFile(join(root, 'file.txt'), 'a\n');
  expect(editorDiffFormat.prompts).toBe('editor-diff');
  expect(editorDiffFencedFormat.prompts).toBe('editor-diff-fenced');
  expect(editorWholeFormat.prompts).toBe('editor-whole');
  await editorDiffFormat.withPlan(
    'file.txt\n<<<<<<< SEARCH\na\n=======\nd\n>>>>>>> REPLACE\n',
    context,
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toHaveLength(1);
      await plan.apply();
    },
  );
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('d\n');

  await editorWholeFormat.withPlan(
    'file.txt\n```\ne\n```\n',
    context,
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toEqual(['file.txt']);
      await plan.apply();
    },
  );
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('e\n');
});

test('active edit modes accept reply-text protocols and omit historical replace_lines tools', async () => {
  const formats = formatsFromFeature();
  const names = [...formats.keys()];
  expect(names).toEqual(expect.arrayContaining(['whole', 'diff', 'diff-fenced', 'udiff', 'udiff-simple', 'patch', 'ask', 'architect', 'context', 'editor-diff', 'editor-diff-fenced', 'editor-whole']));
  expect(names).not.toEqual(expect.arrayContaining(['replace_lines', 'write_file', 'func', 'editblock-func', 'wholefile-func']));
  for (const format of formats.values()) {
    expect(typeof format.withPlan).toBe('function');
    expect(typeof format.prompts).toBe('string');
  }
  expect(wholeFileFormat.prompts).toBe('whole');
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'edit-format: whole\nfile: [notes.txt]\nyes-always: true\n' });
  await writeFile(join(f.cwd, 'notes.txt'), 'before\n');
  f.replies.push({ text: 'notes.txt\n```\nafter\n```\n' });
  const session = await f.open();
  await session.prompt('rewrite notes');
  await session.waitForIdle();
  expect(await readFile(join(f.cwd, 'notes.txt'), 'utf8')).toBe('after\n');
  expect(f.errors).toEqual([]);
});
