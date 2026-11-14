import { createHash } from 'node:crypto';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { autopilotFamilies } from './families/pr-autopilot.ts';
import { shippingRealFamily } from './families/pr-real-forge.ts';
import { removeRunContainers, shippingFamily, shippingFreshnessFamily } from './families/pr-shipping.ts';
import type { Facts } from './fixtures/real-forge.ts';
import { defineFamilyTests } from './lib/define.ts';

const rename = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(/verifier-(\d+)(-\w+)?|owner-([abc])|watch-hourly/g, (id) => `observed-${createHash('sha256').update(id).digest('hex').slice(0, 12)}`)) as T;

const families = [shippingFamily, shippingFreshnessFamily, ...autopilotFamilies].map((family) => ({
  ...family,
  id: `${family.id}-observed-identities`,
  spec: {
    ...family.spec,
    runId: `${family.spec.runId}-observed`,
    cleanup: (ctx: Parameters<NonNullable<typeof family.spec.cleanup>>[0]) => removeRunContainers(`${family.spec.runId}-observed`, ctx.repo),
    prepare: (ctx: Parameters<NonNullable<typeof family.spec.prepare>>[0]) => {
      family.spec.prepare?.(ctx);
      const file = join(ctx.sandbox, 'sim-scenario/scenario.json');
      writeFileSync(file, JSON.stringify(rename(JSON.parse(readFileSync(file, 'utf8')))));
    },
    scenario: (ctx: Parameters<typeof family.spec.scenario>[0]) => rename(family.spec.scenario(ctx)),
  },
  negatives: [
    {
      name: 'two workers claim the same responsibility',
      mutate: (sandbox: string, view: Parameters<(typeof family.checks)[0]['run']>[0]) => {
        const worker = view.runs.flatMap((run) => run.workers).find((entry) => entry.assignment['role'] === 'verifier') ?? view.runs.flatMap((run) => run.workers).find((entry) => entry.assignment['role'] === 'owner');
        if (worker === undefined) throw new Error('No worker to duplicate');
        const dir = worker.dir.replace(view.sandbox, sandbox);
        cpSync(dir, join(dir, '..', 'ambiguous-worker'), { recursive: true });
      },
      fails: family.checks.filter((entry) => (family.id === 'autopilot-hold' ? /one-container-owner-per-pr/ : /one-container-verifier-per-pr|independent-verifier-per-pr|three-independent-lanes/).test(entry.id)).map((entry) => entry.id),
    },
  ],
}));

defineFamilyTests(families);

test('real-forge verdict facts do not prescribe verifier names', () => {
  const record = JSON.parse(readFileSync(join(import.meta.dirname, 'real-forge-evidence/shipping-real.json'), 'utf8')) as { facts: Facts };
  const facts = rename(record.facts);
  const verdictCheck = shippingRealFamily.facts.find((entry) => entry.id === 'real.ship.verdicts-match-what-the-code-does-and-cover-the-head');
  expect(verdictCheck?.run(facts)).toMatchObject({ ok: true });
  const duplicate = structuredClone(facts);
  const [first, second] = duplicate.prs;
  const firstId = /verifier=(\S+)/.exec(first?.comments.find((entry) => /PSTACK-VERDICT/.test(entry.body))?.body ?? '')?.[1];
  if (second === undefined || firstId === undefined) throw new Error('Missing recorded verdicts');
  second.comments.forEach((entry) => {
    entry.body = entry.body.replace(/verifier=\S+/, `verifier=${firstId}`);
  });
  expect(verdictCheck?.run(duplicate)).toMatchObject({ ok: false });
});
