import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { forgeResolvedOnce } from './families/pr-shared.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const result = (commands: string[], note = 'forge: `gh` (origin CLI absent)') => {
  const sandbox = mkdtempSync(join(tmpdir(), 'forge-resolution-'));
  roots.push(sandbox);
  const dir = forgeDirOf(sandbox);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ prs: {} }));
  writeFileSync(join(dir, 'actions.jsonl'), JSON.stringify({ kind: 'read', tool: 'gh' }) + '\n');
  const view = { sandbox, runs: [{ todoText: '', decisions: [['forge', note]] }], parent: { messages: [], toolCalls: commands.map((command, order) => ({ order, name: 'bash', args: { command } })) } } as unknown as RunView;
  return forgeResolvedOnce('forge', { file: 'poteto-mode/playbooks/shipping.md', anchor: 'record the fallback' }, 'gh').run(view);
};

test('a compound lookup and a decision-trail fallback record satisfy the forge contract', () => {
  expect(result(['cd /repo && command -v origin; gh pr view 1'])).toMatchObject({ ok: true });
  expect(result(['cd /repo && command -v gh origin; gh pr view 1'])).toMatchObject({ ok: true });
});
test('an unresolved forge, a late lookup, or an unrecorded fallback still fails', () => {
  expect(result(['gh pr view 1'])).toMatchObject({ ok: false });
  expect(result(['cd /repo && gh pr view 1', 'command -v origin'])).toMatchObject({ ok: false });
  expect(result(['gh pr view 1; command -v origin'])).toMatchObject({ ok: false });
  expect(result(['command -v origin; gh pr view 1'], '')).toMatchObject({ ok: false });
});
