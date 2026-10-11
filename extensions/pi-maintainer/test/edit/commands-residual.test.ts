import { expect, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import type { CommandEnv } from '../../src/core/command.ts';
import { editCommands } from '../../src/edit/commands.ts';
import { estimateFencedFileTokens, fileTokenRows, formatFileTokenLines } from '../../src/edit/file-token-listing.ts';
import { editFormatAfterModelSwitch, rolesAfterEditorModelSwitch, rolesAfterMainModelSwitch } from '../../src/edit/model-switch.ts';
import { disabledGitPolicy, disabledRepositoryContext, type EditFormatName } from '../../src/feature.ts';
import { defined } from '../support/defined.ts';

function baseSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root: '/repo',
    mode: 'diff',
    phase: { kind: 'main' },
    files: { editable: [], readOnly: [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: { provider: 'p', id: 'gpt-3.5' },
    editorModel: { provider: 'p', id: 'editor' },
    weakModel: { provider: 'p', id: 'weak' },
    assistantCommits: [],
    lifecycle: { kind: 'idle' },
    ...overrides,
  };
}

function commandEnv(options: { readonly snapshot: Snapshot; readonly defaults?: Record<string, EditFormatName> }): { readonly env: CommandEnv; readonly saves: Snapshot[] } {
  const saves: Snapshot[] = [];
  let snapshot = options.snapshot;
  const defaults = options.defaults ?? {};
  const env = {
    host: { output() {}, warning() {}, error() {}, confirm: async () => true, select: async () => undefined, exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }) },
    get snapshot() {
      return snapshot;
    },
    save(next: Snapshot) {
      snapshot = next;
      saves.push(next);
    },
    findPhysicalModel: (name: string) => {
      const slash = name.indexOf('/');
      if (slash > 0) return { provider: name.slice(0, slash), id: name.slice(slash + 1) };
      return { provider: 'p', id: name };
    },
    defaultEditFormat: (model: { provider: string; id: string } | null) => (model ? (defaults[model.id] ?? 'whole') : 'whole'),
    setPhysicalModel: async () => true,
  } as unknown as CommandEnv;
  return { env, saves };
}

test('context-usage file rows list editable and read-only names with estimates and a drop hint', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_tokens'] },
}, () => {
  const rows = fileTokenRows({
    editable: [
      { relative: 'foo.txt', content: 'hello' },
      { relative: 'bar.txt', content: 'x'.repeat(40) },
    ],
    readOnly: [{ relative: 'note.md', content: 'readonly body' }],
    estimate: (name, content) => name.length + content.length,
  });
  expect(rows.map((row) => row.label)).toEqual(['foo.txt', 'note.md (read-only)', 'bar.txt']);
  expect(rows.every((row) => row.tip === '/drop to remove')).toBe(true);
  expect(rows.every((row) => row.tokens > 0)).toBe(true);
  const lines = formatFileTokenLines(rows).join('\n');
  expect(lines).toContain('foo.txt');
  expect(lines).toContain('bar.txt');
  expect(lines).toContain('note.md (read-only)');
  expect(lines).toContain('/drop to remove');
});

test('native fenced-file token estimates use Pi estimateTokens', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_tokens'] },
}, () => {
  const short = estimateFencedFileTokens('a.txt', 'hi');
  const long = estimateFencedFileTokens('a.txt', 'hi'.repeat(200));
  expect(short).toBeGreaterThan(0);
  expect(long).toBeGreaterThan(short);
});

test('main model switch preserves editor and weak roles and an explicit edit format', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_model', 'test_commands/TestCommands.test_cmd_model_preserves_explicit_edit_format'],
  },
}, () => {
  const roles = rolesAfterMainModelSwitch({
    editor: { provider: 'p', id: 'editor' },
    weak: { provider: 'p', id: 'weak' },
    nextMain: { provider: 'p', id: 'gpt-4' },
  });
  expect(roles).toEqual({
    main: { provider: 'p', id: 'gpt-4' },
    editor: { provider: 'p', id: 'editor' },
    weak: { provider: 'p', id: 'weak' },
  });
  expect(editFormatAfterModelSwitch({ current: 'udiff', oldModelDefault: 'diff', newModelDefault: 'whole' })).toBe('udiff');
});

test('main model switch adopts the new model default when format was not explicit', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_model_updates_default_edit_format'] },
}, () => {
  expect(editFormatAfterModelSwitch({ current: 'diff', oldModelDefault: 'diff', newModelDefault: 'whole' })).toBe('whole');
});

test('editor model switch preserves main and weak roles for the next reconstruction', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_editor_model'] },
}, () => {
  expect(
    rolesAfterEditorModelSwitch({
      main: { provider: 'p', id: 'main' },
      weak: { provider: 'p', id: 'weak' },
      nextEditor: { provider: 'p', id: 'gpt-4' },
    }),
  ).toEqual({
    main: { provider: 'p', id: 'main' },
    editor: { provider: 'p', id: 'gpt-4' },
    weak: { provider: 'p', id: 'weak' },
  });
});

test('/model adopts the new packaged default and keeps editor and weak selections', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_model', 'test_commands/TestCommands.test_cmd_model_updates_default_edit_format'],
  },
}, async () => {
  const model = editCommands.find((command) => command.name === 'model');
  expect(model).toBeDefined();
  const { env, saves } = commandEnv({
    snapshot: baseSnapshot({ mode: 'diff' }),
    defaults: { 'gpt-3.5': 'diff', 'gpt-4': 'whole' },
  });
  await defined(model).run('gpt-4', env);
  expect(saves.at(-1)).toMatchObject({
    physicalModel: { provider: 'p', id: 'gpt-4' },
    editorModel: { provider: 'p', id: 'editor' },
    weakModel: { provider: 'p', id: 'weak' },
    mode: 'whole',
  });
});

test('/model preserves an explicit edit format across the main model switch', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_model_preserves_explicit_edit_format'] },
}, async () => {
  const model = editCommands.find((command) => command.name === 'model');
  const { env, saves } = commandEnv({
    snapshot: baseSnapshot({ mode: 'udiff' }),
    defaults: { 'gpt-3.5': 'diff', 'gpt-4': 'whole' },
  });
  await defined(model).run('gpt-4', env);
  expect(saves.at(-1)?.mode).toBe('udiff');
});

test('/editor-model preserves main and weak selections on the snapshot', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_editor_model'] },
}, async () => {
  const editor = editCommands.find((command) => command.name === 'editor-model');
  const { env, saves } = commandEnv({ snapshot: baseSnapshot() });
  await defined(editor).run('gpt-4', env);
  expect(saves.at(-1)).toMatchObject({
    physicalModel: { provider: 'p', id: 'gpt-3.5' },
    editorModel: { provider: 'p', id: 'gpt-4' },
    weakModel: { provider: 'p', id: 'weak' },
  });
});

test('/tokens lists selected editable and read-only files with estimates and a drop hint', {
  meta: { aider: ['test_commands/TestCommands.test_cmd_tokens'] },
}, async () => {
  const tokens = editCommands.find((command) => command.name === 'tokens');
  const outputs: string[] = [];
  const { env } = commandEnv({
    snapshot: baseSnapshot({
      files: { editable: ['/repo/foo.txt'], readOnly: ['/repo/bar.txt'] },
    }),
  });
  const wired = {
    ...env,
    git: disabledGitPolicy,
    map: disabledRepositoryContext,
    host: {
      output: (text: string) => outputs.push(text),
      warning() {},
      error() {},
      confirm: async () => true,
      select: async () => undefined,
      exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    },
    tree: {
      read: async (path: string) => (path.endsWith('foo.txt') ? 'editable body' : path.endsWith('bar.txt') ? 'readonly body' : null),
      write: async () => {},
      exists: async () => true,
      touch: async () => {},
      remove: async () => {},
      mkdir: async () => {},
    },
  } as unknown as CommandEnv;
  await defined(tokens).run('', wired);
  const text = outputs.join('\n');
  expect(text).toContain('foo.txt');
  expect(text).toContain('bar.txt');
  expect(text).toContain('(read-only)');
  expect(text).toContain('/drop to remove');
});
