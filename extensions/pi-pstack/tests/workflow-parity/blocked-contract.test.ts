import { expect, test } from 'vitest';

import { shippingNoForgeTokenFamily } from './families/pr-shipping.ts';
import type { RunView } from './lib/view.ts';

const check = shippingNoForgeTokenFamily.checks.find((entry) => entry.id === 'ship.blocked.no-local-fallback-verifies')!;
const result = (modes: string[], attempts: number) => check.run({ runs: [{ workers: modes.map((mode) => ({ id: mode, assignment: { workspace: { mode } } })) }], parent: { toolCalls: Array.from({ length: attempts }, () => ({ name: 'pstack_worker', args: { action: 'spawn' } })) } } as unknown as RunView);

test('several refused container attempts are not a local verification fallback', () => {
  expect(result(['container'], 3)).toMatchObject({ ok: true });
});
test('using a local verifier is still forbidden', () => {
  expect(result(['container', 'worktree'], 2)).toMatchObject({ ok: false });
  expect(result(['readonly'], 1)).toMatchObject({ ok: false });
});
