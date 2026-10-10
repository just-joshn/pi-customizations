import { expect, test } from 'vitest';
import type { EditContext, EditFormat } from '../src/feature.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, isEditFormatName, registerEditFormat } from '../src/feature.ts';

type Tagged = readonly [path: string | null, tag: string];

const context: EditContext = {
  fence: ['```', '```'],
  root: '/project',
  inchatRelativeFiles: [],
  absRootPath: (path) => `/project/${path}`,
  tree: {
    dryRun: false,
    read: async () => null,
    write: async () => {},
    exists: async () => false,
    touch: async () => true,
    remove: async () => {},
    mkdir: async () => {},
    mutate: async (_paths, operation) => operation(context.tree),
  },
  notices: { output: () => {}, warning: () => {}, error: () => {} },
};

function recordingFormat(): { format: EditFormat<Tagged>; applied: Tagged[][] } {
  const applied: Tagged[][] = [];
  const format: EditFormat<Tagged> = {
    name: 'whole',
    prompts: 'whole',
    editIntent: (edit) => (edit[0] === null ? null : { kind: 'upsert', path: edit[0] }),
    getEdits: (content) => content.split(' ').map((word): Tagged => [word === '-' ? null : word, `tag:${word}`]),
    applyEditsDryRun: (edits) => edits.filter((edit) => edit[1] !== 'tag:skip'),
    applyEdits: async (edits) => {
      applied.push([...edits]);
    },
  };
  return { format, applied };
}

test('a registered format plans targets after dry run plus permission', async () => {
  const recorder = recordingFormat();
  const { applied } = recorder;
  const format = registerEditFormat(recorder.format);
  await format.withPlan(
    'a.py skip - b.py',
    context,
    async (candidates) => candidates.filter((candidate) => candidate.edit[0] !== 'b.py'),
    async (plan) => {
      expect(plan.targets).toEqual(['a.py', null]);
      expect(applied).toEqual([]);
      await plan.apply();
    },
  );
  expect(applied).toEqual([
    [
      ['a.py', 'tag:a.py'],
      [null, 'tag:-'],
    ],
  ]);
});

test('disabled ports report disabled rather than success', async () => {
  expect(disabledGitPolicy.repoRoot()).toBe(null);
  expect(await disabledGitPolicy.trackedFiles()).toBe(null);
  expect(await disabledGitPolicy.autoCommit(new Set(['a.py']), { kind: 'linter' })).toEqual({ kind: 'disabled' });
  expect(await disabledGitPolicy.dirtyCommit(new Set(['a.py']))).toEqual({ kind: 'disabled' });
  expect(await disabledGitPolicy.undo()).toEqual({ kind: 'disabled' });
  expect(await disabledRepositoryContext.repoMap({ chatFiles: new Set(), otherFiles: new Set(), mentionedFnames: new Set(), mentionedIdents: new Set() })).toBe(null);
  expect(await disabledValidation.lintEdited(new Set(['a.py']))).toEqual({ kind: 'disabled' });
  expect(await disabledValidation.testEdited()).toEqual({ kind: 'disabled' });
  expect(await disabledValidation.runSuggestedShell(['echo hi'])).toEqual({ kind: 'disabled' });
});

test('edit format names follow Aider coder edit formats', () => {
  expect(['whole', 'diff', 'udiff-simple', 'help', 'code', 'unified'].map(isEditFormatName)).toEqual([true, true, true, true, false, false]);
});
