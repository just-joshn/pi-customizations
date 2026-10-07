import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';
import type { Command } from '../../src/orchestrator/command.ts';
import { tempRepo, writeAndCommit } from '../integration/repo.ts';
import { FakeSkillRuntime } from '../support/fake-skills.ts';
import { ALL_SKILLS } from '../unit/support.ts';
import { BUG_EVIDENCE, BUG_NODES, FEATURE_EVIDENCE, FEATURE_NODES, FEATURE_SCRIPT, INTEGRATOR, MODEL_CHANGES, MODEL_UNCHANGED, REVIEW, REVIEW_FINDING, SEAM } from './scenarios.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Run = { readonly code: number | null; readonly stdout: string };

function s50(cwd: string, ...args: string[]): Run {
  const result = spawnSync(process.execPath, [MAIN, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout };
}

type Applied = { readonly kind: string; readonly phase: string; readonly status: { readonly kind: string } };

function applyOk(cwd: string, command: Command): Applied {
  const result = s50(cwd, 'apply', JSON.stringify(command));
  const parsed: Applied = JSON.parse(result.stdout);
  if (parsed.kind !== 'ok') throw new Error(`${command.kind}: ${result.stdout}`);
  return parsed;
}

function applyAllOk(cwd: string, commands: readonly Command[]): string {
  let last = '';
  for (const command of commands) {
    const applied = applyOk(cwd, command);
    last = `${applied.phase}/${applied.status.kind}`;
  }
  return last;
}

async function scripted(runtime: FakeSkillRuntime, skill: string, objective: string): Promise<readonly Command[]> {
  const result = await runtime.run(skill, { phase: 'scripted', objective });
  return [{ kind: 'invoke_skill', skill }, ...result.commands];
}

function stateFile(cwd: string, name: string): string {
  return readFileSync(join(cwd, '.s50', name), 'utf8');
}

function phaseLine(cwd: string): string {
  return s50(cwd, 'status').stdout.split('\n')[1] ?? '';
}

function setup(): string {
  const cwd = tempRepo();
  dirs.push(cwd);
  expect(s50(cwd, 'registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json')).toEqual({
    code: 0,
    stdout: 'locked 18 skills at 2026-10-07T09:14:55Z\n',
  });
  return cwd;
}

function integrate(cwd: string, id: string, files: Readonly<Record<string, string>>): string {
  applyAllOk(cwd, [
    { kind: 'start_nodes', ids: [id] },
    { kind: 'complete_node', id, passed: true },
  ]);
  const revision = writeAndCommit(cwd, files, `feat: ${id}`);
  return applyAllOk(cwd, [{ kind: 'integrate_node', id, revision, changedPaths: Object.keys(files), integrator: INTEGRATOR }]);
}

function reviewVerifyFreeze(cwd: string, evidence: readonly Command[]): string {
  applyAllOk(cwd, [
    { kind: 'advance', to: 'INTEGRATE' },
    { kind: 'advance', to: 'REVIEW' },
    { kind: 'record_finding', finding: REVIEW_FINDING },
  ]);
  const findingId = s50(cwd, 'status').stdout.match(/open findings: (finding-\S+)/)?.[1] ?? '';
  applyAllOk(cwd, [{ kind: 'resolve_finding', id: findingId, resolution: 'resolved' }, REVIEW, { kind: 'advance', to: 'VERIFY' }, ...evidence]);
  return applyAllOk(cwd, [{ kind: 'advance', to: 'FREEZE_REVISION' }, { kind: 'freeze_revision' }, { kind: 'advance', to: 'REVERIFY_STALE' }, { kind: 'advance', to: 'PR_READY' }]);
}

function reverifyAfterEdit(cwd: string, path: string, evidence: readonly Command[], staleCount: number): void {
  writeAndCommit(cwd, { [path]: `// edited\n` }, 'fix: follow-up edit');
  const resumed = s50(cwd, 'resume');
  expect(resumed.code).toBe(0);
  expect(resumed.stdout.split('\n')[1]).toBe('phase: REVERIFY_STALE (active)');
  expect(resumed.stdout).toContain(`stale evidence: ${staleCount}`);
  expect(s50(cwd, 'verify').stdout).toContain(`MISSING`);
  expect(s50(cwd, 'explain').stdout).toContain(`revision_changed: revision`);
  expect(applyAllOk(cwd, [...evidence, REVIEW, { kind: 'freeze_revision' }, { kind: 'advance', to: 'PR_READY' }])).toBe('PR_READY/pr_ready');
  expect(s50(cwd, 'resume').stdout).toContain('stale evidence: 0');
  expect(phaseLine(cwd)).toBe('phase: PR_READY (pr_ready)');
}

const record = (items: typeof FEATURE_EVIDENCE): readonly Command[] => items.map((evidence): Command => ({ kind: 'record_evidence', evidence }));

describe('s50 CLI process', () => {
  test('feature flow survives restarts through stale reverify', { timeout: 120_000 }, async () => {
    const cwd = setup();
    const runtime = new FakeSkillRuntime(FEATURE_SCRIPT);
    const started = s50(cwd, 'feature', 'export invoices as CSV', '--criteria', 'csv lists every invoice;readme documents export', '--installed', ALL_SKILLS.join(','));
    expect([started.code, started.stdout.split('\n')[1]]).toEqual([0, 'phase: CLARIFY (active)']);
    const run = JSON.parse(stateFile(cwd, 'run.json'));
    expect([run.schemaVersion, run.phase, run.preflight.revision, stateFile(cwd, '.gitignore')]).toEqual([2, 'CLARIFY', run.currentRevision, '*\n']);
    expect(applyAllOk(cwd, [...(await scripted(runtime, 'grilling', run.objective)), { kind: 'advance', to: 'DOMAIN' }])).toBe('DOMAIN/active');
    expect(applyAllOk(cwd, [MODEL_CHANGES, ...(await scripted(runtime, 'domain-modeling', run.objective)), { kind: 'advance', to: 'ARCHITECT' }, ...(await scripted(runtime, 'codebase-design', run.objective))])).toBe('ARCHITECT/active');
    expect(applyAllOk(cwd, [{ kind: 'advance', to: 'CONFIRM_TDD_SEAMS' }, ...(await scripted(runtime, 'tdd', run.objective))])).toBe('CONFIRM_TDD_SEAMS/blocked');
    expect(runtime.calls.map((call) => call.skill)).toEqual(['grilling', 'domain-modeling', 'codebase-design', 'tdd']);
    expect(phaseLine(cwd)).toBe('phase: CONFIRM_TDD_SEAMS (blocked)');
    expect(
      applyAllOk(cwd, [
        { kind: 'confirm_seams', ids: ['seam-cli'] },
        { kind: 'advance', to: 'BUILD_GRAPH' },
        { kind: 'build_graph', nodes: FEATURE_NODES },
        { kind: 'advance', to: 'IMPLEMENT' },
      ]),
    ).toBe('IMPLEMENT/active');
    expect(integrate(cwd, 'list-invoices', { 'src/list/index.ts': 'export const list = [];\n' })).toBe('IMPLEMENT/active');
    expect(integrate(cwd, 'export-csv', { 'src/export/csv.ts': 'export const csv = 2;\n', 'docs/readme.md': '# export\n' })).toBe('IMPLEMENT/active');
    expect(reviewVerifyFreeze(cwd, record(FEATURE_EVIDENCE))).toBe('PR_READY/pr_ready');
    expect(phaseLine(cwd)).toBe('phase: PR_READY (pr_ready)');
    expect(s50(cwd, 'verify')).toEqual({ code: 0, stdout: 'consumer route: drive_executable\nMEASURED csv lists every invoice\nMEASURED readme documents export\n' });
    const evidence = stateFile(cwd, 'evidence.jsonl')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(evidence.filter((record) => record.state === 'MEASURED' && record.method === 'cli').map((record) => record.claim)).toEqual(['csv-output', 'readme-export']);
    reverifyAfterEdit(cwd, 'src/export/csv.ts', record(FEATURE_EVIDENCE.filter((evidence) => evidence.claim === 'csv-output')), 2);
  });

  test('bug flow survives restarts through stale reverify', { timeout: 120_000 }, async () => {
    const cwd = setup();
    const runtime = new FakeSkillRuntime(FEATURE_SCRIPT);
    const started = s50(cwd, 'bug', 'parser crashes on empty line', '--criteria', 'empty line no longer crashes', '--installed', ALL_SKILLS.join(','));
    expect([started.code, started.stdout.split('\n')[1]]).toEqual([0, 'phase: DIAGNOSE (active)']);
    const loop = { id: 'repro-1', kind: 'failing_test', command: 'bun run test -- parser', symptom: 'TypeError on empty line', status: 'red', promotedTo: null, instrumentation: [] } as const;
    expect(
      applyAllOk(cwd, [
        { kind: 'invoke_skill', skill: 'diagnosing-bugs' },
        { kind: 'record_diagnostic', loop },
        { kind: 'record_root_cause', cause: 'split() yields [""] for empty input' },
        { kind: 'advance', to: 'DOMAIN' },
        MODEL_UNCHANGED,
        { kind: 'advance', to: 'ARCHITECT' },
        ...(await scripted(runtime, 'codebase-design', 'parser crashes on empty line')),
        { kind: 'advance', to: 'CONFIRM_TDD_SEAMS' },
        { kind: 'propose_seams', seams: [SEAM] },
      ]),
    ).toBe('CONFIRM_TDD_SEAMS/blocked');
    expect(
      applyAllOk(cwd, [
        { kind: 'confirm_seams', ids: ['seam-cli'] },
        { kind: 'promote_diagnostic', loopId: 'repro-1', seamId: 'seam-cli' },
        { kind: 'advance', to: 'BUILD_GRAPH' },
        { kind: 'build_graph', nodes: BUG_NODES },
        { kind: 'advance', to: 'IMPLEMENT' },
      ]),
    ).toBe('IMPLEMENT/active');
    expect(integrate(cwd, 'fix-parser', { 'src/parser/split.ts': 'export const split = (s: string) => (s === "" ? [] : s.split("\\n"));\n' })).toBe('IMPLEMENT/active');
    expect(applyAllOk(cwd, [{ kind: 'record_diagnostic', loop: { ...loop, promotedTo: 'seam-cli', status: 'green' } }])).toBe('IMPLEMENT/active');
    expect(JSON.parse(stateFile(cwd, 'run.json')).diagnostics).toEqual([{ ...loop, promotedTo: 'seam-cli', status: 'green' }]);
    expect(reviewVerifyFreeze(cwd, record(BUG_EVIDENCE))).toBe('PR_READY/pr_ready');
    expect(phaseLine(cwd)).toBe('phase: PR_READY (pr_ready)');
    reverifyAfterEdit(cwd, 'src/parser/split.ts', record(BUG_EVIDENCE), 3);
  });
});
