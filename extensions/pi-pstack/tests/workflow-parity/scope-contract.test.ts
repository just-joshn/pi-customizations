import { expect, test } from 'vitest';

import { shippingFamily } from './families/pr-shipping.ts';
import { check, evaluate, fail, pass, src, summarize, table } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const source = src('poteto-mode/references/worker-assignment.md', 'A writable worker saves it under its worker directory');

test('an adaptation failure stays visible without failing upstream parity', () => {
  const results = evaluate([
    check('upstream', 'upstream behavior', source, () => pass('tested')),
    check('adaptation', 'adaptation evidence', source, () => fail('missing receipt'), 'adaptation'),
  ], {} as RunView);
  expect(summarize(results)).toMatchObject({ upstream: { verdict: 'PASS', PASS: 1, FAIL: 0 }, adaptation: { verdict: 'FAIL', PASS: 0, FAIL: 1 } });
  expect(table('shipping', 'real', results)).toContain('1 PASS upstream; 0 PASS, 1 FAIL adaptation');
  expect(table('shipping', 'real', results)).toContain('FAIL   [adaptation] adaptation');
});

test('shipping missing receipts fail the adaptation contract, not the upstream contract', () => {
  const receipt = shippingFamily.checks.find((entry) => entry.id === 'ship.each-verifier-recorded-its-own-receipt');
  expect(receipt).toBeDefined();
  const results = evaluate([receipt!], { runs: [], sandbox: '/missing' } as unknown as RunView);
  expect(results[0]).toMatchObject({ scope: 'adaptation', verdict: 'FAIL' });
  expect(summarize(results)).toMatchObject({ upstream: { FAIL: 0 }, adaptation: { verdict: 'FAIL', FAIL: 1 } });
});
