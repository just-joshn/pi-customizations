import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { designFamilies } from './families/design.ts';
import type { RunView } from './lib/view.ts';

test('a rubric file reaches the judge without exposing it to candidates', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'file-rubric-'));
  try {
    const path = join(sandbox, 'rubric.md');
    writeFileSync(path, '1. Correct boundary\n2. Safe invalid input\n3. Preserved API\n');
    const candidate = { id: 'candidate', assignment: { role: 'candidate' }, brief: 'Build the helper.' };
    const judge = { id: 'judge', assignment: { role: 'judge' }, brief: `The rubric is at ${path}. Read it first.\n- candidate: /candidate/worktree`, session: { toolCalls: [{ name: 'read', order: 0, args: { path } }], messages: [] } };
    const view = { sandbox, repo: sandbox, runs: [{ workers: [candidate, judge] }], parent: { messages: [], toolCalls: [] } } as unknown as RunView;
    const check = designFamilies.flatMap((family) => family.checks).find((entry) => entry.id === 'arena.rubric-held-back');
    expect(check?.run(view)).toMatchObject({ ok: true });
    candidate.brief += ` Read ${path}.`;
    expect(check?.run(view)).toMatchObject({ ok: false });
    candidate.brief = 'Build the helper. Correct boundary';
    expect(check?.run(view)).toMatchObject({ ok: false });
    candidate.brief = 'Build the helper.';
    writeFileSync(path, '1. Correct boundary\n2. Safe invalid input\n');
    expect(check?.run(view)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
