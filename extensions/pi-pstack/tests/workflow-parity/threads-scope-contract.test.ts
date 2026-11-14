import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { babysitThreadsOnlyFamily } from './families/pr-babysit.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test.for(['valid', 'resolve-ask', 'ci'])('threads-only permits multiple grounded replies and keeps an escalated finding open (%s)', (mode) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'thread-scope-'));
  try {
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    const threads = [{ id: 'dismiss-123', resolved: true, comments: [{ id: 'old', body: 'checkout() drops couponPercent' }] }, { id: 'billing-456', resolved: mode === 'resolve-ask', comments: [{ id: 'risk', body: 'A negative couponPercent raises the billed amount' }, { id: 'response', body: 'Waiting for an operator decision.' }] }];
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: { 13: { threads } } }));
    const actions = [{ kind: 'reply', thread: 'dismiss-123', body: 'src/checkout.js passes couponPercent to total().' }, { kind: 'resolve', thread: 'dismiss-123' }, { kind: 'reply', thread: 'billing-456', body: 'Waiting for the operator.' }, ...(mode === 'resolve-ask' ? [{ kind: 'resolve', thread: 'billing-456' }] : []), ...(mode === 'ci' ? [{ kind: 'rerun' }] : [])];
    writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), actions.map((entry) => JSON.stringify(entry)).join('\n'));
    const view = { sandbox, runs: [], parent: { messages: [{ role: 'assistant', order: 3, text: 'Should I fix the negative coupon billing finding?' }], toolCalls: [{ name: 'read', order: 1, args: { path: '/repo/src/checkout.js' }, resultText: 'total(items, couponPercent)', isError: false }, { name: 'bash', order: 2, args: { command: 'gh api --method POST endpoint/replies --input reply.json' }, resultText: '', isError: false }] } } as unknown as RunView;
    const run = (id: string) => babysitThreadsOnlyFamily.checks.find((check) => check.id === `babysit.threads.${id}`)?.run(view);
    expect(run('touches-only-threads')).toMatchObject({ ok: mode === 'valid' });
    expect(run('dismissal-grounded-and-the-ask-left-open')).toMatchObject({ ok: mode !== 'resolve-ask' });
    expect(run('ask-is-recorded-and-put-to-the-user')).toMatchObject({ ok: true });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
