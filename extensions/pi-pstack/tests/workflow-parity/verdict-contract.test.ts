import { expect, test } from 'vitest';
import { verdictsOf } from './families/pr-shipping.ts';
import type { ForgeAction, ForgeState } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const head = 'a'.repeat(40);
const state = { prs: { 21: { author: 'owner' } } } as unknown as ForgeState;
const view = { sandbox: '/nonexistent', runs: [{ workers: [{ id: 'v', assignment: { workerId: 'v', role: 'verifier', workspace: { inputCommit: head } } }] }] } as unknown as RunView;
const action = (body: string, worker = 'v'): ForgeAction => ({ kind: 'comment', pr: 21, worker, body, run: 'r', actor: '', container: true });

test('a verifier can post the skill verdict without an invented comment protocol', () => {
  expect(verdictsOf(state, [action('PASS: the user behavior works.')], view)).toMatchObject([{ pr: 21, verdict: 'PASS', head, author: 'v', verifier: 'v' }]);
});
test('a stray mention or an unidentified reviewer does not establish a verdict at a head', () => {
  expect(verdictsOf(state, [action('CI says PASS, not a user verdict')], view)).toEqual([]);
  expect(verdictsOf(state, [action('PASS: works', 'unknown')], view)).toEqual([]);
});
