import { describe, expect, test } from 'vitest';
import { FakeSkillRuntime } from '../../src/adapters/skills.ts';
import type { RunState } from '../../src/domain/run.ts';
import type { Mode } from '../../src/domain/state.ts';
import { latestByClaim } from '../../src/evidence/invalidation.ts';
import { fixedClock } from '../../src/orchestrator/clock.ts';
import { apply, type Command, nextAction, startRun } from '../../src/orchestrator/coordinator.ts';
import { prReadyBlockers } from '../../src/policy/completion.ts';
import { ALL_SKILLS, NO_CAPS, registry } from '../unit/support.ts';
import { BUG_CRITERIA, BUG_EVIDENCE, BUG_NODES, FEATURE_CRITERIA, FEATURE_EVIDENCE, FEATURE_NODES, FEATURE_SCRIPT, REVIEW_FINDING, SEAM } from './scenarios.ts';

class Harness {
  readonly clock = fixedClock();
  readonly runtime: FakeSkillRuntime;
  readonly summaries: string[] = [];
  state: RunState;

  constructor(mode: Mode, criteria: readonly string[], script = FEATURE_SCRIPT) {
    this.runtime = new FakeSkillRuntime(script);
    this.state = startRun(
      {
        mode,
        objective: mode === 'bug' ? 'parser crashes on empty line' : 'export invoices as CSV',
        repository: '/repo',
        revision: 'r1',
        consumer: { kind: 'cli', userPath: 'invoices export' },
        acceptanceCriteria: criteria,
        constraints: [],
        nonGoals: [],
        capabilities: { ...NO_CAPS, installedSkills: ALL_SKILLS },
      },
      registry(),
      this.clock,
    );
  }

  step(command: Command): RunState {
    const outcome = apply(this.state, command, this.clock);
    if (outcome.kind === 'rejected') throw new Error(`${command.kind}: ${outcome.reason}`);
    this.summaries.push(...outcome.decisions.map((decision) => decision.summary));
    this.state = outcome.state;
    return this.state;
  }

  steps(commands: readonly Command[]): RunState {
    for (const command of commands) this.step(command);
    return this.state;
  }

  async skill(name: string): Promise<RunState> {
    this.step({ kind: 'invoke_skill', skill: name });
    const result = await this.runtime.run(name, { phase: this.state.run.phase, objective: this.state.run.objective });
    return this.steps(result.commands);
  }

  phase(): string {
    return `${this.state.run.phase}/${this.state.run.status.kind}`;
  }

  latest(): readonly (readonly string[])[] {
    return latestByClaim(this.state.evidence).map((record) => [record.claim, record.state, record.revision]);
  }
}

const advance = (to: Extract<Command, { kind: 'advance' }>['to']): Command => ({ kind: 'advance', to });

async function featureToReady(h: Harness): Promise<void> {
  h.steps([advance('PREFLIGHT'), advance('CLASSIFY'), advance('CLARIFY')]);
  expect(nextAction(h.state)).toEqual({ kind: 'invoke_skill', skill: 'grilling' });
  await h.skill('grilling');
  expect(h.state.run.domain.decisions.map((decision) => decision.id)).toEqual(['q-format', 'shared-understanding']);
  expect(nextAction(h.state)).toEqual({ kind: 'advance', to: 'DOMAIN' });
  h.step(advance('DOMAIN'));
  await h.skill('domain-modeling');
  h.step(advance('ARCHITECT'));
  await h.skill('codebase-design');
  expect(h.state.run.architecture.chosen).toEqual({ id: 'stream', reason: 'bounded memory' });
  h.step(advance('CONFIRM_TDD_SEAMS'));
  await h.skill('tdd');
  expect(h.phase()).toBe('CONFIRM_TDD_SEAMS/blocked');
  expect(nextAction(h.state)).toEqual({ kind: 'human_gate', gate: { kind: 'seam_confirmation', seams: ['seam-cli'] } });
  h.steps([{ kind: 'confirm_seams', ids: ['seam-cli'] }, { kind: 'record_test', seam: 'seam-cli', test: 'tdd' }, advance('BUILD_GRAPH')]);
  h.steps([{ kind: 'build_graph', nodes: FEATURE_NODES }, advance('IMPLEMENT')]);
  expect(nextAction(h.state)).toEqual({ kind: 'start_nodes', ids: ['list-invoices'] });
  h.steps([
    { kind: 'start_nodes', ids: ['list-invoices'] },
    { kind: 'complete_node', id: 'list-invoices', passed: true },
    { kind: 'integrate_node', id: 'list-invoices', revision: 'r2', changedPaths: ['src/list/index.ts'] },
  ]);
  expect(nextAction(h.state)).toEqual({ kind: 'start_nodes', ids: ['export-csv'] });
  h.steps([
    { kind: 'start_nodes', ids: ['export-csv'] },
    { kind: 'complete_node', id: 'export-csv', passed: true },
    { kind: 'integrate_node', id: 'export-csv', revision: 'r3', changedPaths: ['src/export/csv.ts', 'docs/readme.md'] },
    advance('INTEGRATE'),
    advance('REVIEW'),
    { kind: 'record_finding', finding: REVIEW_FINDING },
  ]);
  expect(h.state.findings.map((finding) => [finding.id, finding.status, finding.revision])).toEqual([['finding-1', 'open', 'r3']]);
  expect(apply(h.state, advance('VERIFY'), h.clock)).toEqual({ kind: 'rejected', reason: 'cannot advance REVIEW -> VERIFY: open findings: finding-1', gate: null });
  h.steps([{ kind: 'resolve_finding', id: 'finding-1', resolution: 'resolved' }, advance('VERIFY')]);
  expect(nextAction(h.state)).toEqual({ kind: 'verify', route: { kind: 'drive_executable' }, criteria: [...FEATURE_CRITERIA] });
  h.steps(FEATURE_EVIDENCE.map((evidence): Command => ({ kind: 'record_evidence', evidence })));
  expect(h.latest()).toEqual([
    ['csv-output', 'MEASURED', 'r3'],
    ['readme-export', 'MEASURED', 'r3'],
  ]);
  h.steps([advance('FREEZE_REVISION'), { kind: 'freeze_revision' }, advance('REVERIFY_STALE'), advance('PR_READY')]);
}

describe('e2e scenarios', () => {
  test('feature flow reaches PR_READY', async () => {
    const h = new Harness('feature', FEATURE_CRITERIA);
    await featureToReady(h);
    expect(h.state.run.status).toEqual({ kind: 'pr_ready', revision: 'r3' });
    expect(h.state.graph.nodes.map((item) => item.status)).toEqual(['integrated', 'integrated']);
    expect(h.runtime.calls.map((call) => call.skill)).toEqual(['grilling', 'domain-modeling', 'codebase-design', 'tdd']);
    expect(h.summaries.filter((summary) => summary.startsWith('advance'))).toEqual([
      'advance START -> PREFLIGHT',
      'advance PREFLIGHT -> CLASSIFY',
      'advance CLASSIFY -> CLARIFY',
      'advance CLARIFY -> DOMAIN',
      'advance DOMAIN -> ARCHITECT',
      'advance ARCHITECT -> CONFIRM_TDD_SEAMS',
      'advance CONFIRM_TDD_SEAMS -> BUILD_GRAPH',
      'advance BUILD_GRAPH -> IMPLEMENT',
      'advance IMPLEMENT -> INTEGRATE',
      'advance INTEGRATE -> REVIEW',
      'advance REVIEW -> VERIFY',
      'advance VERIFY -> FREEZE_REVISION',
      'advance FREEZE_REVISION -> REVERIFY_STALE',
      'advance REVERIFY_STALE -> PR_READY',
    ]);
    expect(nextAction(h.state)).toEqual({ kind: 'done', revision: 'r3' });
  });

  test('bug flow promotes its reproducer before PR_READY', async () => {
    const loop = { id: 'repro-1', kind: 'failing_test', command: 'npm test -- parser', symptom: 'TypeError on empty line', status: 'red', promotedTo: null } as const;
    const h = new Harness('bug', BUG_CRITERIA, {
      ...FEATURE_SCRIPT,
      'diagnosing-bugs': [
        {
          skill: 'diagnosing-bugs',
          summary: 'red repro, root cause',
          commands: [
            { kind: 'record_diagnostic', loop },
            { kind: 'record_root_cause', cause: 'split() yields [""] for empty input' },
          ],
        },
      ],
    });
    h.steps([advance('PREFLIGHT'), advance('CLASSIFY'), advance('DIAGNOSE')]);
    expect(nextAction(h.state)).toEqual({ kind: 'invoke_skill', skill: 'diagnosing-bugs' });
    await h.skill('diagnosing-bugs');
    expect([h.phase(), h.state.run.testContract.confirmedSeams, h.state.run.diagnostics]).toEqual(['DIAGNOSE/active', [], [loop]]);
    expect(h.state.run.rootCause).toBe('split() yields [""] for empty input');
    h.steps([advance('DOMAIN'), advance('ARCHITECT')]);
    await h.skill('codebase-design');
    h.steps([advance('CONFIRM_TDD_SEAMS'), { kind: 'propose_seams', seams: [SEAM] }]);
    expect(h.phase()).toBe('CONFIRM_TDD_SEAMS/blocked');
    h.steps([
      { kind: 'confirm_seams', ids: ['seam-cli'] },
      { kind: 'promote_diagnostic', loopId: 'repro-1', seamId: 'seam-cli' },
    ]);
    expect(h.state.run.diagnostics).toEqual([{ ...loop, status: 'promoted', promotedTo: 'seam-cli' }]);
    h.steps([
      advance('BUILD_GRAPH'),
      { kind: 'build_graph', nodes: BUG_NODES },
      advance('IMPLEMENT'),
      { kind: 'start_nodes', ids: ['fix-parser'] },
      { kind: 'complete_node', id: 'fix-parser', passed: true },
      { kind: 'integrate_node', id: 'fix-parser', revision: 'r2', changedPaths: ['src/parser/split.ts'] },
      advance('INTEGRATE'),
      advance('REVIEW'),
      { kind: 'record_finding', finding: { ...REVIEW_FINDING, trigger: 'whitespace-only line' } },
      { kind: 'resolve_finding', id: 'finding-1', resolution: 'resolved' },
      advance('VERIFY'),
    ]);
    expect(prReadyBlockers(h.state)).toEqual(['revision not frozen', 'criterion "empty line no longer crashes" lacks MEASURED evidence at r2']);
    h.steps(BUG_EVIDENCE.map((evidence): Command => ({ kind: 'record_evidence', evidence })));
    expect(h.latest()).toEqual([
      ['reproducer-green', 'MEASURED', 'r2'],
      ['consumer-cli-empty-line', 'MEASURED', 'r2'],
    ]);
    h.steps([advance('FREEZE_REVISION'), { kind: 'freeze_revision' }, advance('REVERIFY_STALE'), advance('PR_READY')]);
    expect(h.state.run.status).toEqual({ kind: 'pr_ready', revision: 'r2' });
  });

  test('revision change stales only affected evidence', async () => {
    const h = new Harness('feature', FEATURE_CRITERIA);
    await featureToReady(h);
    h.step({ kind: 'revision_changed', revision: 'r4', changedPaths: ['src/export/csv.ts'] });
    expect([h.phase(), h.state.run.currentRevision]).toEqual(['REVERIFY_STALE/active', 'r4']);
    expect(h.latest()).toEqual([
      ['csv-output', 'STALE', 'r3'],
      ['readme-export', 'MEASURED', 'r4'],
    ]);
    expect(prReadyBlockers(h.state)).toEqual(['frozen revision r3 differs from current r4', 'criterion "csv lists every invoice" lacks MEASURED evidence at r4 (STALE@r3)']);
    expect(nextAction(h.state)).toEqual({ kind: 'verify', route: { kind: 'drive_executable' }, criteria: ['csv lists every invoice'] });
    const reverified = FEATURE_EVIDENCE.filter((evidence) => evidence.claim === 'csv-output').map((evidence): Command => ({ kind: 'record_evidence', evidence }));
    h.steps([...reverified, { kind: 'freeze_revision' }, advance('PR_READY')]);
    expect(h.state.run.status).toEqual({ kind: 'pr_ready', revision: 'r4' });
    expect(h.latest()).toEqual([
      ['csv-output', 'MEASURED', 'r4'],
      ['readme-export', 'MEASURED', 'r4'],
    ]);
  });

  test('auto-invoking triage is rejected with the exact gate', () => {
    const h = new Harness('external_issue', FEATURE_CRITERIA);
    h.steps([advance('PREFLIGHT'), advance('CLASSIFY')]);
    expect(apply(h.state, { kind: 'invoke_skill', skill: 'triage' }, h.clock)).toEqual({
      kind: 'rejected',
      reason: 'triage is user-only; the user must run /skill:triage',
      gate: { kind: 'user_workflow', skill: 'triage', action: '/skill:triage' },
    });
    h.step(advance('EXPLICIT_TRIAGE'));
    expect(nextAction(h.state)).toEqual({ kind: 'human_gate', gate: { kind: 'user_workflow', skill: 'triage', action: '/skill:triage' } });
    h.steps([{ kind: 'complete_user_workflow', skill: 'triage' }, advance('CLARIFY')]);
    expect(h.phase()).toBe('CLARIFY/active');
    expect(h.runtime.calls).toEqual([]);
  });
});
