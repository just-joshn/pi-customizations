import { expect, test } from 'vitest';
import { families } from './families/index.ts';
import { shippingFamily } from './families/pr-shipping.ts';
import { check, evaluate, fail, pass, resultExitCode, src, summarize, table } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const source = src('poteto-mode/references/worker-assignment.md', 'A writable worker saves it under its worker directory');

test('an adaptation failure stays visible without failing upstream parity', () => {
  const results = evaluate([check('upstream', 'upstream behavior', source, () => pass('tested')), check('adaptation', 'adaptation evidence', source, () => fail('missing receipt'), 'adaptation')], {} as RunView);
  expect(summarize(results)).toMatchObject({ upstream: { verdict: 'PASS', PASS: 1, FAIL: 0 }, adaptation: { verdict: 'FAIL', PASS: 0, FAIL: 1 } });
  expect(table('shipping', 'real', results)).toContain('1 PASS upstream; 0 PASS, 1 FAIL adaptation');
  expect(table('shipping', 'real', results)).toContain('FAIL   [adaptation] adaptation');
  expect(resultExitCode(results, 'real')).toBe(4);
  expect(resultExitCode(results, 'scripted')).toBe(1);
  expect(
    resultExitCode(
      results.filter((entry) => entry.scope === 'upstream'),
      'real',
    ),
  ).toBe(0);
});

test('registered receipt verification is adaptation evidence while TODO behavior stays upstream', () => {
  const checks = new Map(families.flatMap((family) => family.checks.map((entry) => [entry.id, entry] as const)));
  const receipts = [...checks.values()].filter((entry) => /^todo\..*\.done-steps-proven$/.test(entry.id));
  expect(receipts).toHaveLength(21);
  for (const entry of receipts) expect(entry.scope, entry.id).toBe('adaptation');
  for (const id of ['investigation.receipts-recorded', 'ship.fresh.each-verifier-recorded-its-own-receipt']) expect(checks.get(id)?.scope, id).toBe('adaptation');
  for (const entry of checks.values()) {
    if (/^todo\./.test(entry.id) && !entry.id.endsWith('.done-steps-proven')) expect(entry.scope, entry.id).toBe('upstream');
  }
});

test('shipping missing receipts fail the adaptation contract, not the upstream contract', () => {
  const receipt = shippingFamily.checks.find((entry) => entry.id === 'ship.each-verifier-recorded-its-own-receipt');
  expect(receipt).toBeDefined();
  if (receipt === undefined) throw new Error('shipping receipt check is missing');
  const results = evaluate([receipt], { runs: [], sandbox: '/missing' } as unknown as RunView);
  expect(results[0]).toMatchObject({ scope: 'adaptation', verdict: 'FAIL' });
  expect(summarize(results)).toMatchObject({ upstream: { FAIL: 0 }, adaptation: { verdict: 'FAIL', FAIL: 1 } });
});
