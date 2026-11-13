import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { orchestrateFamilies } from './families/pr-orchestrate.ts';
import { defineFamilyTests } from './lib/define.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

const rename = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(/sub-greet-area|sub-greet|owner-(?:51|52a|52b|61|62a|62b)|verifier-(?:51|52|61|62)|watch-52|watch-rollup/g, (id) => `observed-${Buffer.from(id).toString('hex')}`)) as T;

test('ambiguous subcoordinators fail with both observed candidate names', () => {
  const family = orchestrateFamilies.find((entry) => entry.id === 'orchestrate-sub')!;
  const entry = family.checks.find((check) => /the-tree-is-three-levels/.test(check.id))!;
  const view = { runs: [{ workers: ['area-alpha', 'area-beta'].map((id) => ({ id, assignment: { capabilities: { spawn: true } } })) }] } as unknown as RunView;
  expect(evaluate([entry], view)[0]).toMatchObject({ verdict: 'FAIL', evidence: expect.stringMatching(/candidates: area-alpha, area-beta/) });
});

defineFamilyTests(orchestrateFamilies.map((family) => ({
  ...family,
  id: `${family.id}-observed-identities`,
  spec: {
    ...family.spec,
    prepare: (ctx) => {
      family.spec.prepare?.(ctx);
      const file = join(ctx.sandbox, 'sim-scenario/scenario.json');
      if (existsSync(file)) writeFileSync(file, JSON.stringify(rename(JSON.parse(readFileSync(file, 'utf8')))));
    },
    scenario: (ctx) => rename(family.spec.scenario(ctx)),
  },
  negatives: [{
    name: 'ambiguous owner candidates',
    mutate: (sandbox, view) => {
      const workers = view.runs.flatMap((run) => run.workers);
      const coordinator = workers.find((worker) => (worker.assignment['capabilities'] as { spawn?: boolean })?.spawn);
      const candidate = coordinator ?? workers.find((worker) => worker.assignment['role'] === 'owner');
      if (!candidate) throw new Error('No identity candidate');
      const dir = candidate.dir.replace(view.sandbox, sandbox);
      cpSync(dir, join(dir, '..', 'ambiguous-candidate'), { recursive: true });
    },
    fails: [family.checks.find((entry) => /one-owner-per-pr-the-only-writer/.test(entry.id))!.id],
  }],
})));
