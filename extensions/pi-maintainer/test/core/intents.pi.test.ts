import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { installMaintainer } from '../../src/core/install.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { type EditContext, type EditFormat, type EditIntent, type GitPolicy, registerEditFormat, type SarFeature } from '../../src/feature.ts';
import { testPrompts } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

type TestIntent = EditIntent;
type TestEdit = readonly [path: string, intent: TestIntent];

async function apply(edits: readonly TestEdit[], context: EditContext): Promise<void> {
  for (const [, intent] of edits) {
    if (intent.kind === 'move') {
      await context.tree.write(context.absRootPath(intent.destination), 'moved\n');
      await context.tree.remove(context.absRootPath(intent.source));
    } else if (intent.kind === 'delete') await context.tree.remove(context.absRootPath(intent.path));
    else {
      const path = context.absRootPath(intent.path);
      if (intent.kind === 'add' && (await context.tree.exists(path))) throw new Error('ADD target already exists');
      await context.tree.write(path, 'written\n');
    }
  }
}

async function fixture(options: { readonly config?: string; readonly git?: GitPolicy; readonly preflight?: (edits: readonly TestEdit[], context: EditContext) => Promise<TestEdit[]>; readonly apply?: typeof apply } = {}) {
  const edits: TestEdit[] = [];
  const git = options.git;
  const extra: readonly SarFeature[] = git ? [{ name: 'git', options: [], commands: [], create: () => git }] : [];
  const format: EditFormat<TestEdit> = {
    name: 'whole',
    prompts: 'whole',
    editIntent: (edit) => edit[1],
    getEdits: (text) => (text === 'RUN' ? [...edits] : []),
    applyEditsDryRun: options.preflight ?? ((items) => [...items]),
    applyEdits: options.apply ?? apply,
  };
  const f = await piSessionFixture({
    ...(options.config === undefined ? {} : { config: options.config }),
    extension: (pi) =>
      installMaintainer(pi, [{ ...editFeature, create: (env) => ({ ...editFeature.create(env), formats: new Map([['whole', registerEditFormat(format)]]) }) }, ...extra], {
        promptSource: testPrompts,
        home: () => '/nonexistent',
        processEnvironment: () => ({}),
      }),
  });
  return { ...f, edits };
}

test('a denied MOVE destination cannot overwrite it or remove the admitted source', async () => {
  const f = await fixture({ config: 'file: [source.txt]\n' });
  const source = join(f.cwd, 'source.txt');
  const destination = join(f.cwd, 'destination.txt');
  await writeFile(source, 'source\n');
  await writeFile(destination, 'protected\n');
  f.edits.push(['source.txt', { kind: 'move', source: 'source.txt', destination: 'destination.txt' }]);
  f.replies.push({ text: 'RUN' });
  const session = await f.open();
  await promptAndSettle(session, 'move it');
  expect(await readFile(source, 'utf8')).toBe('source\n');
  expect(await readFile(destination, 'utf8')).toBe('protected\n');
  expect(
    session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === 'custom')
      .map((entry) => entry.data),
  ).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'operation-intent' })]));
  expect(f.errors).toEqual([]);
});

test('explicit consent permits an absolute MOVE destination outside the root', async () => {
  const f = await fixture({ config: 'file: [source.txt]\nyes-always: true\n' });
  const source = join(f.cwd, 'source.txt');
  const destination = join(f.root, 'outside.txt');
  await writeFile(source, 'source\n');
  await writeFile(destination, 'old\n');
  f.edits.push(['source.txt', { kind: 'move', source: 'source.txt', destination }]);
  f.replies.push({ text: 'RUN' });
  const session = await f.open();
  await promptAndSettle(session, 'approve the destination');
  expect(await readFile(destination, 'utf8')).toBe('moved\n');
  await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(restore(session.sessionManager.getBranch()).snapshot?.files.editable).toContain(destination);
  const records = session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === 'custom')
    .map((entry) => entry.data);
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'operation-intent', ordinal: 0, operation: 'write', path: destination }),
      expect.objectContaining({ kind: 'operation-observed', ordinal: 0, outcome: 'succeeded' }),
      expect.objectContaining({ kind: 'operation-intent', ordinal: 1, operation: 'remove', path: source }),
      expect.objectContaining({ kind: 'operation-observed', ordinal: 1, outcome: 'succeeded' }),
      expect.objectContaining({ kind: 'snapshot', lifecycle: expect.objectContaining({ kind: 'active', preparedTargets: ['source.txt'], writtenPaths: [destination, source] }) }),
    ]),
  );
  expect(f.errors).toEqual([]);
});

test('ADD authorization leaves creation to the format', async () => {
  const f = await fixture({ config: 'yes-always: true\n' });
  f.edits.push(['added.txt', { kind: 'add', path: 'added.txt' }]);
  f.replies.push({ text: 'RUN' });
  const session = await f.open();
  await promptAndSettle(session, 'add it');
  expect(await readFile(join(f.cwd, 'added.txt'), 'utf8')).toBe('written\n');
  const records = session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === 'custom')
    .map((entry) => entry.data);
  expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'operation-intent', operation: 'write' })]));
  expect(records).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'operation-intent', operation: 'touch' })]));
  expect(f.requests).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test('a failed MOVE removal keeps the successful destination write separate from prepared targets', async () => {
  const f = await fixture({ config: 'yes-always: true\n' });
  const source = join(f.cwd, 'source');
  const destination = join(f.cwd, 'destination.txt');
  await mkdir(source);
  await writeFile(destination, 'old\n');
  f.edits.push(['source', { kind: 'move', source: 'source', destination: 'destination.txt' }]);
  f.replies.push({ text: 'RUN' });
  const session = await f.open();
  await promptAndSettle(session, 'keep partial-success evidence');
  expect(await readFile(destination, 'utf8')).toBe('moved\n');
  const records = session.sessionManager
    .getBranch()
    .filter((entry) => entry.type === 'custom')
    .map((entry) => entry.data);
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'operation-observed', ordinal: 0, outcome: 'succeeded' }),
      expect.objectContaining({ kind: 'operation-observed', ordinal: 1, outcome: 'failed' }),
      expect.objectContaining({ kind: 'snapshot', lifecycle: expect.objectContaining({ kind: 'active', preparedTargets: ['source'], writtenPaths: [destination] }) }),
    ]),
  );
  expect(f.errors).toEqual([]);
});

test('preflight cannot write before permission even in dry-run mode', async () => {
  const f = await fixture({
    config: 'file: [source.txt]\ndry-run: true\n',
    preflight: async (edits, context) => {
      await context.tree.write(context.absRootPath('source.txt'), 'unapproved');
      return [...edits];
    },
  });
  await writeFile(join(f.cwd, 'source.txt'), 'before\n');
  f.edits.push(['source.txt', { kind: 'update', path: 'source.txt' }]);
  f.replies.push({ text: 'RUN' });
  const session = await f.open();
  await promptAndSettle(session, 'refuse preflight mutation');
  expect(await readFile(join(f.cwd, 'source.txt'), 'utf8')).toBe('before\n');
  expect(f.requests.length).toBeGreaterThanOrEqual(2);
  expect(
    session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === 'custom')
      .map((entry) => entry.data),
  ).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'operation-intent' })]));
  expect(f.errors).toEqual([]);
});

test('preflight cannot introduce an unlocked endpoint for preparation', async () => {
  const f = await fixture({ config: 'yes-always: true\n', preflight: async () => [['other.txt', { kind: 'upsert', path: 'other.txt' }]] });
  f.edits.push(['source.txt', { kind: 'upsert', path: 'source.txt' }]);
  f.replies.push({ text: 'RUN' });
  const session = await f.open();
  await promptAndSettle(session, 'keep the initial lock set');
  const tree = createWorkingTree({ notices: { output: () => {}, warning: () => {}, error: () => {} } });
  expect(await tree.exists(join(f.cwd, 'other.txt'))).toBe(false);
  expect(
    session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === 'custom')
      .map((entry) => entry.data),
  ).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'operation-intent' })]));
  expect(f.errors).toEqual([]);
});
