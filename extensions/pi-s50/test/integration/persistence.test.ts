import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { type CliContext, runCli } from '../../src/cli/commands.ts';
import { fixedClock } from '../../src/orchestrator/clock.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { loadState, migrate, saveState } from '../../src/orchestrator/persistence.ts';
import { ALL_SKILLS, expectOk, freshRun, measured } from '../unit/support.ts';
import { tempRepo } from './repo.ts';

const dirs: string[] = [];

function repo(): string {
  const cwd = tempRepo();
  dirs.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function context(cwd: string): CliContext {
  return { cwd, clock: fixedClock(), fetchText: () => Promise.reject(new Error('network disabled in tests')) };
}

const REFRESH = ['registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json'];
const START = ['feature', 'export invoices', '--criteria', 'csv lists invoices', '--installed', ALL_SKILLS.join(',')];

describe('.s50 persistence', () => {
  test('state round-trips with append-only evidence history', async () => {
    const dir = join(repo(), '.s50');
    const first = freshRun();
    await saveState(dir, null, first, []);
    const second = { ...first, evidence: [measured('a', 'r1'), measured('a', 'r1', { id: 'ev-2', state: 'STALE', supersedes: 'ev-a' })] };
    await saveState(dir, first, second, []);
    const loaded = await loadState(dir);
    expect(loaded).toEqual({ kind: 'ok', state: second, migrated: false });
    expect(readFileSync(join(dir, 'evidence.jsonl'), 'utf8').trim().split('\n').length).toBe(2);
  });

  test('schema v1 run migrates to v2', async () => {
    const dir = join(repo(), '.s50');
    const current = freshRun();
    await saveState(dir, null, current, []);
    const { diagnostics: _dropped, phase: _phase, ...rest } = current.run;
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...rest, schemaVersion: 1, status: 'IMPLEMENT' }));
    const loaded = await loadState(dir);
    if (loaded.kind !== 'ok') throw new Error(loaded.kind);
    expect([loaded.migrated, loaded.state.run.schemaVersion, loaded.state.run.phase, loaded.state.run.status, loaded.state.run.diagnostics]).toEqual([true, 2, 'IMPLEMENT', { kind: 'active' }, []]);
  });

  test.for([
    [{ schemaVersion: 7 }, 'unsupported run schema version 7'],
    [{ schemaVersion: 1, status: { kind: 'active' } }, 'v1 run.json status must be a phase string'],
    [[], 'run.json is not an object'],
  ] as const)('migrate rejects %j', ([input, reason]) => {
    expect(migrate(input)).toEqual({ kind: 'invalid', reason });
  });

  test('corrupt run.json is reported invalid', async () => {
    const dir = join(repo(), '.s50');
    await saveState(dir, null, freshRun(), []);
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...freshRun().run, phase: 'NOPE' }));
    const loaded = await loadState(dir);
    expect(loaded.kind === 'invalid' && loaded.reason.startsWith('run.json $.phase: expected one of START|')).toBe(true);
  });
});

describe('CLI over .s50', () => {
  test('resume twice is idempotent', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    await runCli(START, context(cwd));
    const first = await runCli(['resume'], context(cwd));
    const decisions = readFileSync(join(cwd, '.s50/decisions.jsonl'), 'utf8');
    const run = readFileSync(join(cwd, '.s50/run.json'), 'utf8');
    const second = await runCli(['resume'], context(cwd));
    expect(second).toEqual(first);
    expect(readFileSync(join(cwd, '.s50/decisions.jsonl'), 'utf8')).toBe(decisions);
    expect(readFileSync(join(cwd, '.s50/run.json'), 'utf8')).toBe(run);
  });

  test('start walks automatic phases into CLARIFY', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    const started = await runCli(START, context(cwd));
    expect(started.code).toBe(0);
    expect(started.stdout.split('\n').slice(0, 2)).toEqual(['objective: export invoices', 'phase: CLARIFY (active)']);
  });

  test('refresh with a demoted skill keeps lock plus run snapshot', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    await runCli(START, context(cwd));
    const lock = readFileSync(join(cwd, '.s50/registry.lock.json'), 'utf8');
    const refreshed = await runCli(['registry', 'refresh', '--from', 'leaderboard.diagnosing-bugs-rank-51.json', '--sources', 'skill-sources.2026-10-07.json'], context(cwd));
    expect(refreshed).toEqual({ code: 2, stdout: 'ineligible skills outside the top 50: diagnosing-bugs\n' });
    expect(readFileSync(join(cwd, '.s50/registry.lock.json'), 'utf8')).toBe(lock);
    const loaded = await loadState(join(cwd, '.s50'));
    expect(loaded.kind === 'ok' && loaded.state.run.skillRegistry.skills.length).toBe(18);
  });

  test('apply rejects a malformed command at the boundary', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    await runCli(START, context(cwd));
    expect(await runCli(['apply', '{"kind":"advance","to":"NOWHERE"}'], context(cwd))).toEqual({ code: 1, stdout: expect.stringMatching(/^invalid command: \$\.to: expected one of START\|/) });
  });

  test('apply of a user-only skill exits 2 with the gate', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    await runCli(START, context(cwd));
    const result = await runCli(['apply', '{"kind":"invoke_skill","skill":"triage"}'], context(cwd));
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'rejected',
      reason: 'triage is user-only; the user must run /skill:triage',
      gate: { kind: 'user_workflow', skill: 'triage', action: '/skill:triage' },
    });
  });

  test('registry verify accepts the fixture lock', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    expect(await runCli(['registry', 'verify'], context(cwd))).toEqual({ code: 0, stdout: 'registry lock verified\n' });
  });

  test('missing model skill blocks start at preflight', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    const started = await runCli(['bug', 'crash on empty line'], context(cwd));
    expect(started.code).toBe(2);
    expect(started.stdout.split('\n')[1]).toBe('phase: PREFLIGHT (blocked)');
    expect(started.stdout).toContain('next human gate: install diagnosing-bugs: npx skills add mattpocock/skills --skill diagnosing-bugs');
  });

  test('pure apply leaves its input untouched', () => {
    const state = freshRun();
    const snapshot = JSON.stringify(state);
    expectOk(apply(state, { kind: 'confirm_understanding' }, fixedClock()));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
