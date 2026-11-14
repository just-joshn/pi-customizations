import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { shippingFamily } from './families/pr-shipping.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
const reply =
  'The verified run is PR 21 alone. PR 21 is the ceiling.\nPR 21: PASS from v21.\nPR 22: FAIL from v22.\nPR 23: PASS from v23.\nPR 21 landed. I confirmed the merge by reading the PR back.\nThe next gap needs a fix for PR 22 and fresh verification.';
function result(text: string) {
  const sandbox = mkdtempSync(join(tmpdir(), 'shipping-reply-'));
  roots.push(sandbox);
  const dir = forgeDirOf(sandbox);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ prs: { 21: {}, 22: {}, 23: {} } }));
  writeFileSync(
    join(dir, 'actions.jsonl'),
    [21, 22, 23].map((pr) => JSON.stringify({ kind: 'comment', pr, worker: `v${pr}`, body: `PSTACK-VERDICT: ${pr === 22 ? 'FAIL' : 'PASS'} head=${'a'.repeat(40)} verifier=v${pr} patch=p` })).join('\n'),
  );
  const check = shippingFamily.checks.find((entry) => entry.id === 'ship.reply-names-the-run-the-verdicts-what-landed-and-the-next-gap');
  return check?.run({ sandbox, runs: [], parent: { messages: [{ order: 1, role: 'assistant', text }], toolCalls: [] } } as unknown as RunView);
}
test('shipping accepts the required facts in ordinary prose', () => {
  expect(result(reply)).toMatchObject({ ok: true });
  expect(result(reply.replace('I confirmed the merge by reading the PR back.', 'The PR now reads MERGED with base main.'))).toMatchObject({ ok: true });
});
test('a markdown MERGED read-back confirms the landing, but OPEN does not', () => {
  expect(result(reply.replace('I confirmed the merge by reading the PR back.', 'Read back as `MERGED`.'))).toMatchObject({ ok: true });
  expect(result(reply.replace('I confirmed the merge by reading the PR back.', 'Read back as `OPEN`.'))).toMatchObject({ ok: false });
});
test('omitting a producer or the next gap is still a failure', () => {
  expect(result(reply.replace('from v22', ''))).toMatchObject({ ok: false });
  expect(result(reply.split('\nThe next gap')[0] ?? '')).toMatchObject({ ok: false });
});
