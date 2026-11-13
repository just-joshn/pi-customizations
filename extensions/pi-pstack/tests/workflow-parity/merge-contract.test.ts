import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { mergesAreAuthorizedAndVerified } from './families/pr-shipping.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const result = (mergedHead: string, verdict = 'PASS', author = 'owner') => {
  const sandbox = mkdtempSync(join(tmpdir(), 'merge-contract-'));
  roots.push(sandbox);
  const dir = forgeDirOf(sandbox);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ prs: { 21: { author } } }));
  const actions = [{ kind: 'comment', pr: 21, worker: 'v', body: `PSTACK-VERDICT: ${verdict} head=${'a'.repeat(40)} verifier=v patch=p` }, { kind: 'merge', pr: 21, head: mergedHead, requested: null }];
  writeFileSync(join(dir, 'actions.jsonl'), actions.map((action) => JSON.stringify(action)).join('\n'));
  return mergesAreAuthorizedAndVerified('merge', { file: 'poteto-mode/playbooks/shipping.md', anchor: 'Land bottom-up' }).run({ sandbox, prompt: 'ship the stack: land PR 21', runs: [] } as unknown as RunView);
};
test('the merged head can equal the verdict without the undocumented match flag', () => {
  expect(result('a'.repeat(40))).toMatchObject({ ok: true });
});
test('head drift, a failing verdict, and self-verification still block the merge', () => {
  expect(result('b'.repeat(40))).toMatchObject({ ok: false });
  expect(result('a'.repeat(40), 'FAIL')).toMatchObject({ ok: false });
  expect(result('a'.repeat(40), 'PASS', 'v')).toMatchObject({ ok: false });
});
