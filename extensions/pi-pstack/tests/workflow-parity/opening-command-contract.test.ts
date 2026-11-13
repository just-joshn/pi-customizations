import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { openingFamily } from './families/pr-review.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
function result(draft = false) {
  const sandbox = mkdtempSync(join(tmpdir(), 'opening-command-'));
  roots.push(sandbox);
  const dir = forgeDirOf(sandbox);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ prs: { 11: { state: 'OPEN' }, 12: { state: 'OPEN' } } }));
  writeFileSync(join(dir, 'actions.jsonl'), [11, 12].map((pr) => JSON.stringify({ kind: 'create', tool: 'gh', pr, draft })).join('\n'));
  const commands = ['cd /repo && gh pr create --body-file a.md', 'cd /repo && gh pr create --body-file b.md', 'cd /repo && gh pr view 11 --json isDraft,state,baseRefName', 'cd /repo && gh pr view 12 --json state,isDraft'];
  return openingFamily.checks
    .find((entry) => entry.id === 'open.created-ready-through-the-forge-with-the-body-from-a-file')
    ?.run({ sandbox, parent: { toolCalls: commands.map((command, order) => ({ name: 'bash', order, args: { command } })) } } as unknown as RunView);
}
test('creation and readback can use compound commands and forge-assigned numbers', () => {
  expect(result()).toMatchObject({ ok: true });
});
test('an observed draft still fails regardless of the command layout', () => {
  expect(result(true)).toMatchObject({ ok: false });
});
