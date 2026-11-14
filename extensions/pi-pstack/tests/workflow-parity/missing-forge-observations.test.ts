import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { autopilotFamilies } from './families/pr-autopilot.ts';
import { orchestrateFamily } from './families/pr-orchestrate.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';

test('missing PR heads and ambiguous replaced owners never become checker exceptions', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'missing-forge-'));
  try {
    const dir = forgeDirOf(sandbox);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ prs: {} }));
    writeFileSync(join(dir, 'actions.jsonl'), '');
    const view = { sandbox, driver: 'real', repo: join(sandbox, 'repo'), parent: { messages: [], toolCalls: [] }, runs: [{ workers: ['one', 'two'].map((id) => ({ id, assignment: { role: 'owner' } })) }] } as unknown as RunView;
    const ids = ['autopilot.lanes.three-independent-lanes-fan-out-at-the-code-ready-head', 'autopilot.lanes.a-loosened-gate-got-the-verifiers-proof-and-the-roots-fresh-countersign', 'orchestrate.a-stalled-worker-is-judged-by-its-side-effects-aborted-and-replaced-with-a-consolidated-kickoff'];
    const checks = [...autopilotFamilies.flatMap((family) => family.checks), ...orchestrateFamily.checks].filter((check) => ids.includes(check.id));
    const results = evaluate(checks, view);
    expect(results.map((result) => result.verdict)).toEqual(['FAIL', 'FAIL', 'INCONCLUSIVE']);
    expect(results.every((result) => !/checker threw/.test(result.evidence))).toBe(true);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
