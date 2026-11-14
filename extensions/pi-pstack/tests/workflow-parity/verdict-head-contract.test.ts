import { expect, test } from 'vitest';
import { verdictsOf } from './families/pr-shipping.ts';
import type { ForgeAction, ForgeState } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const view = { sandbox: '/nonexistent', runs: [{ workers: [{ id: 'verifier', assignment: { role: 'verifier', workspace: { inputCommit: head } } }] }] } as unknown as RunView;
const state = { prs: { 22: {} } } as unknown as ForgeState;

test.for([head, base])('a verdict names its head, not the earlier base (%s)', (stated) => {
  const actions = [{ kind: 'comment', pr: 22, worker: 'verifier', body: `PASS+NOTES\nVerdict (base s-1 at ${base.slice(0, 7)}, head s-2 at ${stated.slice(0, 7)}).` }] as ForgeAction[];
  expect(verdictsOf(state, actions, view)[0]?.head).toBe(stated === head ? head : base.slice(0, 7));
});
