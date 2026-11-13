import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { neverMutatesTopology } from './families/pr-shared.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const result = (command: string) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'topology-contract-'));
  roots.push(sandbox);
  mkdirSync(forgeDirOf(sandbox), { recursive: true });
  writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: {} }));
  return neverMutatesTopology('topology', { file: 'poteto-mode/playbooks/shipping.md', anchor: 'Leave the stack alone' }).run({ sandbox, parent: { toolCalls: [{ name: 'bash', order: 1, args: { command } }] } } as unknown as RunView);
};

test('removing a local scratch worktree is not changing stack topology', () => {
  expect(result('git worktree remove --force /scratch/verification')).toMatchObject({ ok: true });
});

test.each(['git push --force origin HEAD', 'git push --force-with-lease origin HEAD', 'git rebase main', 'gh pr edit 22 --base main'])('stack mutation still fails: %s', (command) => {
  expect(result(command)).toMatchObject({ ok: false });
});
