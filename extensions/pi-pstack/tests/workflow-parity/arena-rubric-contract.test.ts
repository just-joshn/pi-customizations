import { expect, test } from 'vitest';
import { arenaFamily } from './families/design.ts';
import type { RunView } from './lib/view.ts';

function view(count: number, leak = false): RunView {
  return {
    parent: { messages: [], toolCalls: [] },
    runs: [
      {
        workers: [
          { id: 'judge', assignment: { role: 'judge' }, brief: `## Rubric\n${Array.from({ length: count }, (_, index) => `${index + 1}. criterion ${index}`).join('\n')}\n\n## Output\n1. scores\n2. winner\n3. rejected\n4. rationale\n` },
          { id: 'candidate', assignment: { role: 'candidate' }, brief: leak ? 'Task: criterion 0' : 'Task: implement the function' },
        ],
      },
    ],
  } as unknown as RunView;
}
const rubric = arenaFamily.checks.find((check) => check.id === 'arena.rubric-held-back');
test('output instructions are not rubric criteria', () => {
  expect(rubric?.run(view(6))).toMatchObject({ ok: true });
});
test('an undersized rubric and leaked criteria remain failures', () => {
  expect(rubric?.run(view(2))).toMatchObject({ ok: false });
  expect(rubric?.run(view(6, true))).toMatchObject({ ok: false });
});
