import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { installMaintainer } from '../../src/core/install.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { contextPrompts } from '../../src/edit/prompts/context.ts';
import type { GitPolicy } from '../../src/feature.ts';
import { maintainerExtension, testPrompts, textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle, scriptedModel } from '../support/pi-session.ts';

test('ask mode answers without writing files', { meta: { aider: ['test_commands/TestCommands.test_cmd_ask'] } }, async () => {
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'edit-format: ask\nfile: [notes.txt]\n' });
  await writeFile(join(f.cwd, 'notes.txt'), 'before\n');
  f.replies.push({ text: 'notes.txt\n```\nafter\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'what does notes say?');
  expect(await readFile(join(f.cwd, 'notes.txt'), 'utf8')).toBe('before\n');
  expect(f.requests).toHaveLength(1);
  expect(restore(session.sessionManager.getBranch()).snapshot?.mode).toBe('ask');
  expect(f.errors).toEqual([]);
});

test('context mode replaces editable files and reflects without applying edits', async () => {
  const tracked: GitPolicy = {
    repoRoot: () => null,
    trackedFiles: async () => ['alpha.txt', 'beta.txt'],
    needToAdd: async () => false,
    isGitIgnored: async () => false,
    stageNewFile: async () => {},
    needsDirtyCommit: async () => false,
    dirtyCommit: async () => ({ kind: 'disabled' }),
    autoCommit: async () => ({ kind: 'disabled' }),
  };
  const f = await piSessionFixture({
    config: 'edit-format: context\nfile: [alpha.txt]\nyes-always: true\n',
    extension: (pi) =>
      installMaintainer(pi, [editFeature, { name: 'git', options: [], commands: [], create: () => tracked }], {
        promptSource: testPrompts,
        home: () => '/nonexistent-maintainer-home',
        processEnvironment: () => ({}),
      }),
  });
  await writeFile(join(f.cwd, 'alpha.txt'), 'alpha\n');
  await writeFile(join(f.cwd, 'beta.txt'), 'beta\n');
  f.replies.push({ text: 'We need beta.txt for the change.\n' }, { text: 'beta.txt is enough.\n' });
  const session = await f.open();
  await promptAndSettle(session, 'which files?');
  expect(await readFile(join(f.cwd, 'alpha.txt'), 'utf8')).toBe('alpha\n');
  expect(await readFile(join(f.cwd, 'beta.txt'), 'utf8')).toBe('beta\n');
  expect(restore(session.sessionManager.getBranch()).snapshot?.files.editable).toEqual([join(f.cwd, 'beta.txt')]);
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]?.messages.filter((message) => message.role === 'user').map(textOf)).toContain(contextPrompts.tryAgain);
  expect(f.errors).toEqual([]);
});

test('context mode skips edit application for blank replies', async () => {
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'edit-format: context\nfile: [only.txt]\n' });
  await writeFile(join(f.cwd, 'only.txt'), 'keep\n');
  f.replies.push({ text: '   \n' });
  const session = await f.open();
  await promptAndSettle(session, 'noop');
  expect(await readFile(join(f.cwd, 'only.txt'), 'utf8')).toBe('keep\n');
  expect(restore(session.sessionManager.getBranch()).snapshot?.files.editable).toEqual([join(f.cwd, 'only.txt')]);
  expect(f.requests).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test('architect mode continues into an editor format that applies the edit', { meta: { aider: ['test_coder/TestCoder.test_architect_coder_auto_accept_true'] } }, async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    config: 'edit-format: architect\nauto-accept-architect: true\neditor-edit-format: editor-whole\nfile: [hello.txt]\nyes-always: true\n',
  });
  await writeFile(join(f.cwd, 'hello.txt'), 'before\n');
  f.replies.push({ text: 'Update hello.txt to say after.' }, { text: 'hello.txt\n```\nafter\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'please edit');
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('after\n');
  expect(f.requests).toHaveLength(2);
  expect(restore(session.sessionManager.getBranch()).snapshot).toMatchObject({ mode: 'architect', phase: { kind: 'main' } });
  const purposes = session.sessionManager.getBranch().flatMap((entry) => {
    if (entry.type !== 'custom_message') return [];
    const details: unknown = entry.details;
    return typeof details === 'object' && details !== null ? [details] : [];
  });
  expect(purposes).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'editor-input' }), expect.objectContaining({ purpose: 'architect-return' })]));
  expect(f.requests[1]?.messages.map(textOf).join('\n')).not.toContain('please edit');
  expect(f.errors).toEqual([]);
});

test('architect mode without auto-accept skips the editor when denied', { meta: { aider: ['test_coder/TestCoder.test_architect_coder_auto_accept_false_rejected'] } }, async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    config: 'edit-format: architect\nauto-accept-architect: false\nfile: [hello.txt]\n',
  });
  await writeFile(join(f.cwd, 'hello.txt'), 'before\n');
  f.replies.push({ text: 'Change hello.txt' });
  const session = await f.open();
  await promptAndSettle(session, 'architect this');
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('before\n');
  expect(f.requests).toHaveLength(1);
  expect(restore(session.sessionManager.getBranch()).snapshot).toMatchObject({ mode: 'architect', phase: { kind: 'main' } });
  expect(f.errors).toEqual([]);
});

test('architect editor request routes to the configured editor model', {
  meta: { aider: ['test_coder/TestCoder.test_architect_coder_auto_accept_true', 'test_coder/TestCoder.test_architect_coder_auto_accept_false_confirmed'] },
}, async () => {
  const editorModel = { ...scriptedModel, id: 'editor-scripted', name: 'Editor scripted' };
  const f = await piSessionFixture({
    extension: maintainerExtension(),
    models: [editorModel],
    config: 'edit-format: architect\nauto-accept-architect: true\neditor-model: editor-scripted\neditor-edit-format: editor-whole\nfile: [hello.txt]\nyes-always: true\n',
  });
  await writeFile(join(f.cwd, 'hello.txt'), 'before\n');
  f.replies.push({ text: 'Edit hello.txt' }, { text: 'hello.txt\n```\ndone\n```\n' });
  const session = await f.open();
  await promptAndSettle(session, 'architect with editor model');
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('done\n');
  expect(f.routedModels).toEqual(['scripted', 'editor-scripted']);
  expect(f.errors).toEqual([]);
});
