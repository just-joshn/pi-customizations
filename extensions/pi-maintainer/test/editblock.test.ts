import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { applyEdits, getEdits } from '../src/edit/editblock.ts';
import { diffFormat } from '../src/edit/feature.ts';
import { createWorkingTree } from '../src/edit/working-tree.ts';
import type { EditContext } from '../src/feature.ts';

async function workingDirectory(initial: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'editblock-test-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(initial)) await writeFile(join(root, path), content);
  const tree = createWorkingTree({
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  });
  return {
    root,
    tree,
    absRootPath: (path: string) => resolve(root, path),
    absFnames: new Set(Object.keys(initial).map((path) => resolve(root, path))),
    fence: ['```', '```'] as const,
  };
}

test('applies a full SEARCH/REPLACE reply', { meta: { aider: ['test_editblock/TestUtils.test_full_edit'] } }, async () => {
  const ctx = await workingDirectory({ 'file.txt': 'one\ntwo\nthree\n' });
  const reply = 'file.txt\n<<<<<<< SEARCH\ntwo\n=======\nnew\n>>>>>>> REPLACE\n';
  const { edits } = getEdits(reply, ctx);
  await applyEdits(edits, ctx);
  expect(await readFile(join(ctx.root, 'file.txt'), 'utf8')).toBe('one\nnew\nthree\n');
});

test('dry-run full SEARCH/REPLACE leaves the file unchanged', { meta: { aider: ['test_editblock/TestUtils.test_full_edit_dry_run'] } }, async () => {
  const ctx = await workingDirectory({ 'file.txt': 'one\ntwo\nthree\n' });
  const dry = createWorkingTree({
    dryRun: true,
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  });
  const reply = 'file.txt\n<<<<<<< SEARCH\ntwo\n=======\nnew\n>>>>>>> REPLACE\n';
  const { edits } = getEdits(reply, ctx);
  await applyEdits(edits, { ...ctx, tree: dry });
  expect(await readFile(join(ctx.root, 'file.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
});

test('diff format plans an upsert for the named file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'editblock-format-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'file.txt'), 'one\ntwo\nthree\n');
  const tree = createWorkingTree({
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  });
  const context: EditContext = {
    fence: ['```', '```'],
    root,
    inchatRelativeFiles: ['file.txt'],
    absRootPath: (path) => resolve(root, path),
    tree,
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  };
  const reply = 'file.txt\n<<<<<<< SEARCH\ntwo\n=======\nnew\n>>>>>>> REPLACE\n';
  await diffFormat.withPlan(
    reply,
    context,
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toEqual(['file.txt']);
      await plan.apply();
    },
  );
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('one\nnew\nthree\n');
});
