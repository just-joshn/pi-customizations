import { expect, test } from 'vitest';
import { swarmFamily } from './families/design.ts';
import type { RunView } from './lib/view.ts';

const files = ['cart.js', 'money.js', 'checkout.js'];
const base = 'a'.repeat(40);
function view(outcome = 'ISSUES', first = 'cart.js'): RunView {
  const reply = ['| Slice | Outcome | SHA | Method |', '| --- | --- | --- | --- |', ...[first, ...files.slice(1)].map((file) => `| \`${file}\` | ${outcome} | \`${base}\` | node --test |`), 'Gaps: none.'].join('\n');
  return {
    base,
    runs: [{ workers: files.map((file, index) => ({ id: `w-${index}`, brief: `Scope: src/${file}`, finalText: `ISSUES at ${base}, method: node --test`, state: { settles: [{ phase: 'idle' }] } })) }],
    parent: { messages: [{ role: 'assistant', order: 1, text: reply }], toolCalls: [] },
  } as unknown as RunView;
}
const ids = ['swarm.results-record-sha-and-method', 'swarm.pass-lanes-have-receipts', 'swarm.report-keeps-outcome-distinctions'];
test.for(ids)('basename slice tables retain upstream meaning: %s', (id) => {
  expect(swarmFamily.checks.find((check) => check.id === id)?.run(view())).toMatchObject({ ok: true });
});
test('unknown slices and invented outcomes remain rejected', () => {
  expect(swarmFamily.checks.find((check) => check.id === ids[0])?.run(view('ISSUES', 'invented.js'))).toMatchObject({ ok: false });
  expect(swarmFamily.checks.find((check) => check.id === ids[2])?.run(view('MAYBE'))).toMatchObject({ ok: false });
});
