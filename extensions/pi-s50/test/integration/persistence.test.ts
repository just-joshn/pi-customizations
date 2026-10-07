import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { type CliContext, runCli } from '../../src/cli/commands.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { loadState, migrate, saveState } from '../../src/orchestrator/persistence.ts';
import { fixedClock } from '../support/clock.ts';
import { testContext } from '../support/context.ts';
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
  return testContext(cwd);
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
    await saveState(dir, null, freshRun(), []);
    const { diagnostics: _dropped, phase: _phase, invokedSkills: _invoked, integrationOwner: _owner, preflight: _preflight, ...rest } = freshRun().run;
    const v1 = { ...rest, schemaVersion: 1, status: 'IMPLEMENT', capabilities: { ...rest.capabilities, installedSkills: ['tdd'] } };
    writeFileSync(join(dir, 'run.json'), JSON.stringify(v1));
    const loaded = await loadState(dir);
    if (loaded.kind !== 'ok') throw new Error(loaded.kind === 'invalid' ? loaded.reason : loaded.kind);
    const { run } = loaded.state;
    expect([loaded.migrated, run.schemaVersion, run.phase, run.status, run.diagnostics, run.capabilities.installedSkills, run.preflight, run.invokedSkills]).toEqual([
      true,
      2,
      'IMPLEMENT',
      { kind: 'active' },
      [],
      [{ name: 'tdd', contentHash: null }],
      null,
      [],
    ]);
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

  test('start records preflight facts in decisions.jsonl', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    await runCli(START, context(cwd));
    const first =
      readFileSync(join(cwd, '.s50/decisions.jsonl'), 'utf8')
        .split('\n')
        .find((line) => line.includes('"preflight"')) ?? '';
    expect(JSON.parse(first).summary).toMatch(/^preflight root=\S+ remote=none rev=[0-9a-f]{40} dirty=false languages=none pm=unknown test=none build=none instructions=none glossary=none adrs=0 react=false installed=grilling,/);
  });

  test('a deleted .s50/.gitignore stays deleted', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    rmSync(join(cwd, '.s50/.gitignore'));
    await runCli(START, context(cwd));
    expect(existsSync(join(cwd, '.s50/.gitignore'))).toBe(false);
  });

  test('every JSONL line carries its schema version', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    await runCli(START, context(cwd));
    const versions = readFileSync(join(cwd, '.s50/decisions.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).schemaVersion);
    expect(new Set(versions)).toEqual(new Set([1]));
  });

  test('run data stays out of git through a self-ignoring .gitignore', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    expect(readFileSync(join(cwd, '.s50/.gitignore'), 'utf8')).toBe('*\n');
  });

  test('a demoted required skill rejects the lock but not the active run', async () => {
    const cwd = repo();
    await runCli(REFRESH, context(cwd));
    await runCli(START, context(cwd));
    const refreshed = await runCli(['registry', 'refresh', '--from', 'leaderboard.diagnosing-bugs-rank-51.json', '--sources', 'skill-sources.2026-10-07.json'], context(cwd));
    expect(refreshed).toEqual({ code: 2, stdout: 'ineligible required skills outside the top 50: diagnosing-bugs; strict mode starts no new run\n' });
    expect(JSON.parse(readFileSync(join(cwd, '.s50/registry.lock.json'), 'utf8'))).toEqual({ schemaVersion: 1, kind: 'rejected', checkedAt: '2026-10-07T09:14:55Z', source: 'https://skills.sh/', ineligible: ['diagnosing-bugs'] });
    const loaded = await loadState(join(cwd, '.s50'));
    expect(loaded.kind === 'ok' && loaded.state.run.skillRegistry.skills.find((skill) => skill.name === 'diagnosing-bugs')?.rank).toBe(42);
  });

  test('a rejected lock refuses every new run', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh', '--from', 'leaderboard.diagnosing-bugs-rank-51.json', '--sources', 'skill-sources.2026-10-07.json'], context(cwd));
    expect(await runCli(START, context(cwd))).toEqual({ code: 2, stdout: 'registry refresh at 2026-10-07T09:14:55Z failed closed: diagnosing-bugs; strict mode starts no new run\n' });
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
    expect(started.code).toBe(3);
    expect(started.stdout.split('\n')[1]).toBe('phase: PREFLIGHT (blocked)');
    expect(started.stdout).toContain('next human gate: install diagnosing-bugs: npx skills add mattpocock/skills --skill diagnosing-bugs');
  });

  test('pure apply leaves its input untouched', () => {
    const state = freshRun();
    const snapshot = JSON.stringify(state);
    expectOk(apply(state, { kind: 'request_authorization', action: 'merge', scope: 'PR 1' }, fixedClock()));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
