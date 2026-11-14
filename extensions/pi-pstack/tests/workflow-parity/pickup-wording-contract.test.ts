import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { pickupFamily } from './families/ops.ts';
import type { RunView } from './lib/view.ts';

test.for([true, false])('pickup reports facts and the opened route without mandatory section labels (outcome=%s)', (outcome) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pickup-wording-'));
  try {
    const worker = join(sandbox, '.pi/pstack/runs/prior-run/workers/old-worker');
    mkdirSync(worker, { recursive: true });
    writeFileSync(join(worker, 'report.md'), 'Pending: 3. exportCsv item rows.\n');
    const report = {
      role: 'assistant',
      order: 1,
      text: `**Inherited.** Units 1 and 2 were already done by old-worker. I checked them against the branch. I redid none of that work. **Resume point.** Unit 3, the item rows, is next. I will continue under Feature.${outcome ? ' I verified the inherited claim; its tests passed.' : ''}`,
    };
    const view = {
      repo: sandbox,
      parent: { messages: [report], toolCalls: [{ name: 'read', args: { path: '/pkg/generated/skills/poteto-mode/playbooks/feature.md' }, order: 0, isError: false, resultText: 'Feature' }] },
    } as unknown as RunView;
    const run = (id: string) => pickupFamily.checks.find((check) => check.id === `pickup.${id}`)?.run(view);
    expect(run('resume-point-is-the-first-unfinished-unit')).toMatchObject({ ok: true });
    expect(run('verdict-and-route')).toMatchObject({ ok: true });
    expect(run('reply-has-the-four-parts')).toMatchObject({ ok: outcome });
    report.text = report.text.replace('Unit 3, the item rows', 'Unit 1, csvRow helper');
    expect(run('resume-point-is-the-first-unfinished-unit')).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
