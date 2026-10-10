import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import {
  type EditCandidate,
  type EditContext,
  type EditIntent,
  type GitPolicy,
  disabledGitPolicy,
  disabledRepositoryContext,
  disabledValidation,
} from '../../src/feature.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';

type Upsert = readonly [string | null, EditIntent | null];

const unusedPrompts = {
  get: async () => {
    throw new Error('prompts unused in authorize tests');
  },
};

function snapshot(root: string, files: { editable?: string[]; readOnly?: string[] } = {}): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'whole',
    phase: { kind: 'main' },
    files: { editable: files.editable ?? [], readOnly: files.readOnly ?? [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: null,
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'idle' },
  };
}

async function harness(options: {
  readonly files?: { editable?: string[]; readOnly?: string[] };
  readonly confirm?: (request: { question: string; subject?: string }) => Promise<boolean>;
  readonly git?: Partial<GitPolicy>;
  readonly dryRun?: boolean;
}) {
  const root = await mkdtemp(join(tmpdir(), 'authorize-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const outputs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const confirms: { question: string; subject?: string }[] = [];
  const staged: string[] = [];
  const dirtyBatches: string[][] = [];
  const host: Host = {
    output: (text) => {
      outputs.push(text);
    },
    warning: (text) => {
      warnings.push(text);
    },
    error: (text) => {
      errors.push(text);
    },
    confirm: async (request) => {
      confirms.push({ question: request.question, ...(request.subject ? { subject: request.subject } : {}) });
      return options.confirm?.({ question: request.question, ...(request.subject ? { subject: request.subject } : {}) }) ?? true;
    },
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const git: GitPolicy = {
    ...disabledGitPolicy,
    ...options.git,
    stageNewFile: async (absPath) => {
      staged.push(absPath);
      await options.git?.stageNewFile?.(absPath);
    },
    dirtyCommit: async (paths, signal) => {
      dirtyBatches.push([...paths].sort());
      return options.git?.dirtyCommit?.(paths, signal) ?? { kind: 'disabled' };
    },
  };
  const tree = createWorkingTree({ notices: host, ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }) });
  const controller = new ExchangeController(snapshot(root, options.files), {
    ports: {
      edit: {
        formats: new Map(),
        requestedFormat: null,
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun: options.dryRun ?? false,
        yesAlways: null,
        autoAcceptArchitect: true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-whole',
        tree,
      },
      git,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: unusedPrompts,
    append: () => {},
    suggestShellCommands: false,
  });
  const context: EditContext = {
    fence: ['```', '```'],
    root,
    inchatRelativeFiles: [],
    absRootPath: (path) => absRootPath(root, path),
    tree,
    notices: host,
  };
  const candidate = (path: string | null, intent: EditIntent | null): EditCandidate<Upsert> => ({
    edit: [path, intent],
    intent,
  });
  const resolved = (path: string) => absRootPath(root, path);
  return { root, controller, context, candidate, resolved, outputs, warnings, errors, confirms, staged, dirtyBatches };
}

test(
  'a missing path asks Create new file and creates it when approved',
  { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_no_files_new_file_should_ask'] } },
  async () => {
    const h = await harness({});
    const prepared = await h.controller.prepareToEdit([h.candidate('nested/new.txt', { kind: 'upsert', path: 'nested/new.txt' })], h.context);
    expect(h.confirms).toEqual([{ question: 'Create new file?', subject: 'nested/new.txt' }]);
    expect(prepared).toHaveLength(1);
    expect(await readFile(join(h.root, 'nested/new.txt'), 'utf8')).toBe('');
    expect(h.controller.snapshot.files.editable).toEqual([h.resolved('nested/new.txt')]);
    expect(h.outputs).toEqual([]);
  },
);

test('declining Create new file skips that path and prints Skipping edits', async () => {
  const h = await harness({ confirm: async () => false });
  const prepared = await h.controller.prepareToEdit([h.candidate('missing.txt', { kind: 'upsert', path: 'missing.txt' })], h.context);
  expect(prepared).toEqual([]);
  expect(h.outputs).toEqual(['Skipping edits to missing.txt']);
  await expect(access(join(h.root, 'missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test(
  'an existing unshared file asks Allow edits and joins the editable set when approved',
  { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_files_not_in_chat'] } },
  async () => {
    const h = await harness({});
    await writeFile(join(h.root, 'outside.txt'), 'before\n');
    const prepared = await h.controller.prepareToEdit([h.candidate('outside.txt', { kind: 'update', path: 'outside.txt' })], h.context);
    expect(h.confirms).toEqual([{ question: 'Allow edits to file that has not been added to the chat?', subject: 'outside.txt' }]);
    expect(prepared).toHaveLength(1);
    expect(h.controller.snapshot.files.editable).toEqual([h.resolved('outside.txt')]);
    expect(await readFile(join(h.root, 'outside.txt'), 'utf8')).toBe('before\n');
  },
);

test('an in-chat editable path is approved without a prompt', async () => {
  const h = await harness({});
  await writeFile(join(h.root, 'chat.txt'), 'before\n');
  const full = h.resolved('chat.txt');
  h.controller.replace(snapshot(h.root, { editable: [full] }));
  const prepared = await h.controller.prepareToEdit([h.candidate('chat.txt', { kind: 'update', path: 'chat.txt' })], h.context);
  expect(h.confirms).toEqual([]);
  expect(prepared).toHaveLength(1);
});

test('a failed Create new file touch reports Unable to create and drops the path', async () => {
  const h = await harness({});
  await writeFile(join(h.root, 'blocked'), 'file\n');
  const prepared = await h.controller.prepareToEdit([h.candidate('blocked/child.txt', { kind: 'upsert', path: 'blocked/child.txt' })], h.context);
  expect(prepared).toEqual([]);
  expect(h.errors).toEqual(['Unable to create blocked/child.txt, skipping edits.']);
  expect(h.controller.snapshot.files.editable).toEqual([]);
});

test('authorization asks once per distinct path and keeps every edit for that answer', async () => {
  const h = await harness({});
  await writeFile(join(h.root, 'shared.txt'), 'before\n');
  const prepared = await h.controller.prepareToEdit(
    [
      h.candidate('shared.txt', { kind: 'update', path: 'shared.txt' }),
      h.candidate('shared.txt', { kind: 'update', path: 'shared.txt' }),
      h.candidate(null, null),
    ],
    h.context,
  );
  expect(h.confirms).toHaveLength(1);
  expect(prepared).toHaveLength(3);
  expect(prepared[2]?.edit[0]).toBeNull();
});

test('a declined path drops every edit for that path while pathless records still pass', async () => {
  const h = await harness({ confirm: async () => false });
  await writeFile(join(h.root, 'shared.txt'), 'before\n');
  const prepared = await h.controller.prepareToEdit(
    [
      h.candidate('shared.txt', { kind: 'update', path: 'shared.txt' }),
      h.candidate('shared.txt', { kind: 'update', path: 'shared.txt' }),
      h.candidate(null, null),
    ],
    h.context,
  );
  expect(prepared).toEqual([expect.objectContaining({ edit: [null, null] })]);
  expect(h.outputs).toEqual(['Skipping edits to shared.txt']);
});

test('a read-only chat file reaches Allow edits and stays in the read-only set when approved', async () => {
  const h = await harness({});
  await writeFile(join(h.root, 'reference.txt'), 'before\n');
  const full = h.resolved('reference.txt');
  h.controller.replace(snapshot(h.root, { readOnly: [full] }));
  const prepared = await h.controller.prepareToEdit([h.candidate('reference.txt', { kind: 'update', path: 'reference.txt' })], h.context);
  expect(h.confirms).toEqual([{ question: 'Allow edits to file that has not been added to the chat?', subject: 'reference.txt' }]);
  expect(prepared).toHaveLength(1);
  expect(h.controller.snapshot.files).toEqual({ editable: [full], readOnly: [full] });
});

test('a path outside the root goes through ordinary approval and is writable when approved', async () => {
  const h = await harness({});
  const outsideRoot = await mkdtemp(join(tmpdir(), 'authorize-outside-'));
  onTestFinished(() => rm(outsideRoot, { recursive: true, force: true }));
  await writeFile(join(outsideRoot, 'external.txt'), 'before\n');
  const target = absRootPath(outsideRoot, 'external.txt');
  const prepared = await h.controller.prepareToEdit([h.candidate(target, { kind: 'update', path: target })], h.context);
  expect(h.confirms).toEqual([{ question: 'Allow edits to file that has not been added to the chat?', subject: target }]);
  expect(prepared).toHaveLength(1);
  expect(h.controller.snapshot.files.editable).toEqual([target]);
  expect(await readFile(target, 'utf8')).toBe('before\n');
});

test('repository policy refusal skips a gitignored path and approved paths reach staging and dirty-commit hooks', async () => {
  const h = await harness({
    git: {
      isGitIgnored: async (path) => path === 'ignored.txt',
      needToAdd: async () => true,
      needsDirtyCommit: async () => true,
    },
  });
  await writeFile(join(h.root, 'ignored.txt'), 'x\n');
  await writeFile(join(h.root, 'tracked.txt'), 'y\n');
  const prepared = await h.controller.prepareToEdit(
    [
      h.candidate('ignored.txt', { kind: 'update', path: 'ignored.txt' }),
      h.candidate('tracked.txt', { kind: 'update', path: 'tracked.txt' }),
      h.candidate('brand-new.txt', { kind: 'upsert', path: 'brand-new.txt' }),
    ],
    h.context,
  );
  expect(h.warnings).toEqual(['Skipping edits to ignored.txt that matches gitignore spec.']);
  expect(prepared.map((entry) => entry.edit[0])).toEqual(['tracked.txt', 'brand-new.txt']);
  expect(h.staged).toEqual([h.resolved('tracked.txt'), h.resolved('brand-new.txt')]);
  expect(h.dirtyBatches).toEqual([['brand-new.txt', 'tracked.txt']]);
});
