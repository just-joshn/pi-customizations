import { expect, test } from 'vitest';
import { shippingNoForgeTokenFamily } from './families/pr-shipping.ts';
import type { RunView } from './lib/view.ts';

const check = shippingNoForgeTokenFamily.checks.find((entry) => entry.id === 'ship.blocked.no-local-fallback-verifies');
const result = (modes: string[], attempts: number) =>
  check?.run({
    runs: [{ workers: modes.map((mode) => ({ id: mode, assignment: { workspace: { mode } } })) }],
    parent: { toolCalls: Array.from({ length: attempts }, () => ({ name: 'pstack_worker', args: { action: 'spawn' } })) },
  } as unknown as RunView);

test('several refused container attempts are not a local verification fallback', () => {
  expect(result(['container'], 3)).toMatchObject({ ok: true });
});
test('a forge refusal after a model error is still a refusal, but the model error alone is not', () => {
  const entry = shippingNoForgeTokenFamily.checks.find((check) => check.id === 'ship.blocked.spawn-is-refused-with-ForgeUnavailable');
  const value = { runs: [{ workers: [] }], parent: { toolCalls: [
    { name: 'pstack_worker', args: { action: 'spawn' }, isError: true, resultText: 'Model unavailable' },
    { name: 'pstack_worker', args: { action: 'spawn' }, isError: true, resultText: 'ForgeUnavailable: no token' },
  ] } } as unknown as RunView;
  expect(entry?.run(value)).toMatchObject({ ok: true });
  value.parent.toolCalls.pop();
  expect(entry?.run(value)).toMatchObject({ ok: false });
});

test('using a local verifier is still forbidden', () => {
  expect(result(['container', 'worktree'], 2)).toMatchObject({ ok: false });
  expect(result(['readonly'], 1)).toMatchObject({ ok: false });
});
