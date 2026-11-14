import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { shippingFamily } from './families/pr-shipping.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test('run-relative verifier artifacts re-verify, but missing or altered evidence still fails', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'shipping-receipts-'));
  roots.push(sandbox);
  const dir = join(sandbox, 'run');
  const workers = [21, 22, 23].map((pr) => ({ id: `v${pr}`, dir: join(dir, `workers/v${pr}`), assignment: { role: 'verifier', workspace: { mode: 'container' } } }));
  const receipts = workers.map((worker) => {
    const path = `workers/${worker.id}/evidence/test.txt`;
    mkdirSync(join(dir, `workers/${worker.id}/evidence`), { recursive: true });
    writeFileSync(join(dir, path), 'tested');
    return { id: worker.id, runId: 'run', verdict: 'pass', artifacts: [{ path, sha256: createHash('sha256').update('tested').digest('hex') }] };
  });
  const forge = forgeDirOf(sandbox);
  mkdirSync(forge, { recursive: true });
  writeFileSync(join(forge, 'state.json'), JSON.stringify({ prs: { 21: {}, 22: {}, 23: {} } }));
  writeFileSync(join(forge, 'actions.jsonl'), [21, 22, 23].map((pr) => JSON.stringify({ kind: 'comment', pr, worker: `v${pr}`, body: `PSTACK-VERDICT: PASS head=${'a'.repeat(40)} verifier=v${pr} patch=p` })).join('\n'));
  const view = { sandbox, runs: [{ id: 'run', dir, workers, receipts }] } as unknown as RunView;
  const check = shippingFamily.checks.find((entry) => entry.id === 'ship.each-verifier-recorded-its-own-receipt');
  expect(check?.run(view)).toMatchObject({ ok: true });
  writeFileSync(join(dir, receipts[0]?.artifacts[0]?.path ?? ''), 'altered');
  expect(check?.run(view)).toMatchObject({ ok: false });
  receipts.splice(0, 1);
  expect(check?.run(view)).toMatchObject({ ok: false });
});
