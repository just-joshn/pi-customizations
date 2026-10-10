import { access, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { ValueError } from '../../src/edit/errors.ts';
import { patchEditIntent, patchFormat } from '../../src/edit/feature.ts';
import { applyEdits, type EditResult } from '../../src/edit/patch.ts';
import { findContextCore } from '../../src/edit/patch-sections.ts';
import type { EditContext } from '../../src/feature.ts';
import { workspace } from './patch-workspace.ts';

function trackedLines(values: readonly string[]): { readonly lines: readonly string[]; reads(): number } {
  let reads = 0;
  const lines = new Proxy(values as string[], {
    get(target, prop, receiver) {
      if (prop === 'slice') {
        return (start = 0, end = target.length) => {
          const from = start < 0 ? Math.max(0, target.length + start) : start;
          const to = end < 0 ? Math.max(0, target.length + end) : Math.min(target.length, end);
          reads += Math.max(0, to - from);
          return target.slice(start, end);
        };
      }
      if (prop === 'map') {
        return (mapper: (value: string, index: number, array: string[]) => unknown) => {
          reads += target.length;
          return target.map(mapper);
        };
      }
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        reads += 1;
        return target[Number(prop)];
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { lines, reads: () => reads };
}

async function blockedAddOutcome() {
  const space = await workspace({ files: { parent: 'regular file\n' } });
  const edits: EditResult[] = [['parent/new.py', { type: 'Add', path: 'parent/new.py', newContent: 'new' }]];
  let raised: { type: string; message: string } | null = null;
  try {
    await applyEdits(edits, space.ctx);
  } catch (error) {
    if (!(error instanceof ValueError)) throw error;
    raised = { type: error.name, message: error.message.replaceAll(space.root, '<root>') };
  }
  return {
    raised,
    notices: space.notices(),
    tree: await space.snapshot(),
  };
}

test('ADD under a regular-file parent raises Python Errno 17', async () => {
  const first = await blockedAddOutcome();
  const second = await blockedAddOutcome();
  expect(first).toEqual(second);
  expect(first.tree).toEqual({ parent: 'regular file\n' });
  expect(first.notices).toEqual([['output', 'Adding parent/new.py']]);
  expect(first.raised).toEqual({
    type: 'ValueError',
    message: "Error applying action 'ActionType.ADD' to parent/new.py: [Errno 17] File exists: '<root>/parent'",
  });
});

test('immediate exact context matches avoid whole-file normalization', () => {
  const { lines, reads } = trackedLines(Array.from({ length: 5000 }, (_, index) => `line ${index}`));
  const positions = Array.from({ length: 25 }, (_, index) => findContextCore(lines, [`line ${index}`], index));
  expect(positions).toEqual(Array.from({ length: 25 }, (_, index) => [index, 0]));
  expect(reads()).toBe(25);
});

test('exact context matches at fuzz 0', { meta: { evidence: ['ev-edit/probe/patch-exact-context'] } }, () => {
  expect(findContextCore(['x = 1'], ['x = 1'], 0)).toEqual([0, 0]);
});

test('trimmed context matches at fuzz 100', { meta: { evidence: ['ev-edit/probe/patch-trimmed-context'] } }, () => {
  expect(findContextCore(['    x = 1   '], ['x = 1'], 0)).toEqual([0, 100]);
});

test('replays the recorded patch CLI update content', { meta: { evidence: ['ev-edit/cli-apply/patch-update'] } }, async () => {
  const space = await workspace({ files: { 'sample.py': 'value = 100\n' } });
  const reply = ['*** Begin Patch', '*** Update File: sample.py', '@@', '-value = 100', '+value = 200', '*** End Patch'].join('\n');
  await patchFormat.withPlan(
    reply,
    {
      fence: ['```', '```'],
      root: space.root,
      inchatRelativeFiles: ['sample.py'],
      absRootPath: space.ctx.absRootPath,
      tree: space.workingTree,
      notices: space.ctx.io,
    },
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toEqual(['sample.py']);
      await plan.apply();
    },
  );
  expect(await readFile(join(space.root, 'sample.py'), 'utf8')).toBe('value = 200\n');
});

test('workspace seeds observe through one sandbox resolver', async () => {
  const space = await workspace({ files: { 'nested/../seeded.py': 'seed\n' } });
  const full = space.ctx.absRootPath('seeded.py');
  expect(await readFile(full, 'utf8')).toBe('seed\n');
  expect(await space.snapshot()).toEqual({ 'seeded.py': 'seed\n' });
});

test('dry-run application leaves DELETE MOVE and nested ADD untouched', {
  meta: {
    evidence: ['ev-edit/patch-lifecycle/dry-run-delete-removed-file', 'ev-edit/patch-lifecycle/dry-run-move-removed-source', 'ev-edit/patch-lifecycle/dry-run-move-created-destination'],
  },
}, async () => {
  const space = await workspace({
    files: { 'source.py': 'old\n' },
    dryRun: true,
  });
  const before = await space.snapshot();
  await applyEdits(
    [
      ['source.py', { type: 'Delete', path: 'source.py' }],
      ['source.py', { type: 'Update', path: 'source.py', chunks: [{ origIndex: 0, delLines: ['old'], insLines: ['new'] }], movePath: 'nested/destination.py' }],
      ['nested/deeper/new.py', { type: 'Add', path: 'nested/deeper/new.py', newContent: 'new' }],
    ],
    space.ctx,
  );
  expect(await space.snapshot()).toEqual(before);
  expect(await readFile(join(space.root, 'source.py'), 'utf8')).toBe('old\n');
  await expect(access(join(space.root, 'nested'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('patch editIntent maps ADD UPDATE DELETE and MOVE', () => {
  expect(patchEditIntent(['added.py', { type: 'Add', path: 'added.py', newContent: 'x' }])).toEqual({ kind: 'add', path: 'added.py' });
  expect(patchEditIntent(['kept.py', { type: 'Update', path: 'kept.py', chunks: [], movePath: null }])).toEqual({ kind: 'update', path: 'kept.py' });
  expect(patchEditIntent(['gone.py', { type: 'Delete', path: 'gone.py' }])).toEqual({ kind: 'delete', path: 'gone.py' });
  expect(patchEditIntent(['source.py', { type: 'Update', path: 'source.py', chunks: [], movePath: 'destination.py' }])).toEqual({
    kind: 'move',
    source: 'source.py',
    destination: 'destination.py',
  });
});

test('declined MOVE destination preserves both files', async () => {
  const space = await workspace({
    files: {
      'source.py': 'old\n',
      'destination.py': 'protected\n',
    },
  });
  const reply = ['*** Begin Patch', '*** Update File: source.py', '*** Move to: destination.py', '@@', '-old', '+new', '*** End Patch'].join('\n');
  const context: EditContext = {
    fence: ['```', '```'],
    root: space.root,
    inchatRelativeFiles: ['source.py'],
    absRootPath: space.ctx.absRootPath,
    tree: space.workingTree,
    notices: { ...space.ctx.io, error: () => {} },
  };
  await patchFormat.withPlan(
    reply,
    context,
    async (candidates) =>
      candidates.filter((candidate) => {
        const intent = candidate.intent;
        return intent?.kind !== 'move' || intent.destination !== 'destination.py';
      }),
    async (plan) => {
      expect(plan.targets).toEqual([]);
      await plan.apply();
    },
  );
  expect(await readFile(join(space.root, 'source.py'), 'utf8')).toBe('old\n');
  expect(await readFile(join(space.root, 'destination.py'), 'utf8')).toBe('protected\n');
});

test('ADD editIntent leaves creation to application', async () => {
  const space = await workspace({ dryRun: false });
  await mkdir(join(space.root, 'dir'), { recursive: true });
  const reply = ['*** Begin Patch', '*** Add File: dir/added.py', '+hello', '*** End Patch'].join('\n');
  const context: EditContext = {
    fence: ['```', '```'],
    root: space.root,
    inchatRelativeFiles: [],
    absRootPath: space.ctx.absRootPath,
    tree: space.workingTree,
    notices: { ...space.ctx.io, error: () => {} },
  };
  await patchFormat.withPlan(
    reply,
    context,
    async (candidates) => {
      expect(candidates.map((candidate) => candidate.intent)).toEqual([{ kind: 'add', path: 'dir/added.py' }]);
      expect(await space.workingTree.exists(space.ctx.absRootPath('dir/added.py'))).toBe(false);
      return [...candidates];
    },
    async (plan) => {
      await plan.apply();
    },
  );
  expect(await readFile(join(space.root, 'dir/added.py'), 'utf8')).toBe('hello\n');
});

test('replays the recorded patch CLI add content', { meta: { evidence: ['ev-edit/cli-apply/patch-add'] } }, async () => {
  const space = await workspace({ dryRun: false });
  const reply = ['*** Begin Patch', '*** Add File: sample.py', '+value = 200', '*** End Patch'].join('\n');
  await patchFormat.withPlan(
    reply,
    {
      fence: ['```', '```'],
      root: space.root,
      inchatRelativeFiles: [],
      absRootPath: space.ctx.absRootPath,
      tree: space.workingTree,
      notices: space.ctx.io,
    },
    async (candidates) => {
      expect(await space.workingTree.exists(space.ctx.absRootPath('sample.py'))).toBe(false);
      return [...candidates];
    },
    async (plan) => {
      expect(plan.targets).toEqual(['sample.py']);
      await plan.apply();
    },
  );
  expect(await readFile(join(space.root, 'sample.py'), 'utf8')).toBe('value = 200\n');
});

test('patch ADD of a path that existed before the reply still fails', async () => {
  const space = await workspace({ files: { 'sample.py': 'already\n' } });
  await expect(applyEdits([['sample.py', { type: 'Add', path: 'sample.py', newContent: 'value = 200' }]], space.ctx)).rejects.toThrow('ADD Error: File already exists: sample.py');
  expect(await readFile(join(space.root, 'sample.py'), 'utf8')).toBe('already\n');
});
