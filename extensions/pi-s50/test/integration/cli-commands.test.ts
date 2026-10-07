import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { type CliContext, runCli } from '../../src/cli/commands.ts';
import { fixedClock } from '../../src/orchestrator/clock.ts';
import { fixturePath } from '../unit/support.ts';
import { git, tempRepo } from './repo.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const cwd = tempRepo();
  dirs.push(cwd);
  return cwd;
}

const PAGE = readFileSync(fixturePath('skills-sh.2026-10-07.excerpt.html'), 'utf8');

function context(cwd: string, fetchText: CliContext['fetchText'] = () => Promise.resolve(PAGE)): CliContext {
  return { cwd, clock: fixedClock(), fetchText };
}

describe('registry commands', () => {
  test('live refresh parses the fetched skills.sh page', async () => {
    const cwd = repo();
    const urls: string[] = [];
    const result = await runCli(
      ['registry', 'refresh'],
      context(cwd, (url) => {
        urls.push(url);
        return Promise.resolve(PAGE);
      }),
    );
    expect([result, urls]).toEqual([{ code: 0, stdout: 'locked 18 skills at 2026-10-07T00:00:00.000Z\n' }, ['https://skills.sh/']]);
  });

  test('refresh fails closed when the page format changes', async () => {
    const cwd = repo();
    expect(
      await runCli(
        ['registry', 'refresh'],
        context(cwd, () => Promise.resolve('<html></html>')),
      ),
    ).toEqual({
      code: 1,
      stdout: 'leaderboard initialSkills payload not found\n',
    });
  });

  test('show lists locked skills with rank, source, policy', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh'], context(cwd));
    const shown = await runCli(['registry', 'show'], context(cwd));
    expect(shown.stdout.split('\n').slice(0, 2)).toEqual(['1 vercel-labs/skills/find-skills model', '2 mattpocock/skills/grill-me user']);
  });

  test('verify accepts a fresh lock', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh'], context(cwd));
    expect(await runCli(['registry', 'verify'], context(cwd))).toEqual({ code: 0, stdout: 'registry lock verified\n' });
  });

  test('show without a lock is blocked', async () => {
    expect(await runCli(['registry', 'show'], context(repo()))).toEqual({ code: 2, stdout: 'no registry lock\n' });
  });

  test('a corrupt lock is reported invalid', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh'], context(cwd));
    writeFileSync(join(cwd, '.s50/registry.lock.json'), '{}');
    expect((await runCli(['registry', 'verify'], context(cwd))).stdout).toMatch(/^invalid registry lock: /);
  });
});

describe('run commands', () => {
  async function started(): Promise<string> {
    const cwd = repo();
    await runCli(['registry', 'refresh'], context(cwd));
    await runCli(['feature', 'export invoices', '--criteria', 'csv lists invoices', '--installed', 'grilling,codebase-design,tdd'], context(cwd));
    return cwd;
  }

  test('verify lists missing evidence with blockers', async () => {
    const result = await runCli(['verify'], context(await started()));
    expect(result.code).toBe(2);
    expect(result.stdout.split('\n').slice(0, 2)).toEqual(['consumer route: drive_executable', 'MISSING csv lists invoices']);
  });

  test('explain ends with the next action', async () => {
    const lines = (await runCli(['explain'], context(await started()))).stdout.trim().split('\n');
    expect(lines.at(-1)).toBe('next: invoke skill grilling');
  });

  test('a second start is refused while a run exists', async () => {
    expect(await runCli(['bug', 'again'], context(await started()))).toEqual({ code: 2, stdout: 'a run already exists in .s50/; use s50 resume\n' });
  });

  test('start without a registry lock is blocked', async () => {
    expect(await runCli(['feature', 'x'], context(repo()))).toEqual({ code: 2, stdout: 'no .s50/registry.lock.json; run s50 registry refresh first\n' });
  });

  test('an unknown consumer kind is rejected', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh'], context(cwd));
    expect(await runCli(['feature', 'x', '--consumer', 'fax:machine'], context(cwd))).toEqual({
      code: 1,
      // biome-ignore lint/security/noSecrets: the CLI's consumer-kind usage text
      stdout: '--consumer kind must be one of browser|electron|cli|tui|http|rpc|library|native\n',
    });
  });

  test('malformed capabilities JSON is rejected', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh'], context(cwd));
    expect((await runCli(['feature', 'x', '--capabilities', '{'], context(cwd))).stdout).toMatch(/^--capabilities: /);
  });

  test('apply rejects invalid JSON at the boundary', async () => {
    expect((await runCli(['apply', '{'], context(await started()))).stdout).toMatch(/^invalid JSON: /);
  });

  test('an unknown subcommand prints usage', async () => {
    expect((await runCli(['launch'], context(repo()))).stdout.split('\n')[0]).toBe('usage: s50 <command>');
  });

  test('a revision other than HEAD is refused', async () => {
    const cwd = await started();
    const command = JSON.stringify({ kind: 'revision_changed', revision: 'f'.repeat(40), changedPaths: [] });
    const head = git(cwd, 'rev-parse', 'HEAD');
    expect(await runCli(['apply', command], context(cwd))).toEqual({
      code: 2,
      stdout: `${JSON.stringify({ kind: 'rejected', reason: `revision_changed names ${'f'.repeat(40)}, but HEAD is ${head}`, gate: null })}\n`,
    });
  });

  test('a rename stales evidence on the old path', async () => {
    const cwd = await started();
    const evidence = { claim: 'csv', criterion: 'csv lists invoices', state: 'MEASURED', dependencies: ['src/export/csv.ts'], method: 'cli', expected: 'rows', observed: 'rows', artifact: 'a.log' };
    await runCli(['apply', JSON.stringify({ kind: 'record_evidence', evidence })], context(cwd));
    git(cwd, 'mv', 'src/export/csv.ts', 'src/export/table.ts');
    git(cwd, 'commit', '-qm', 'rename');
    expect((await runCli(['resume'], context(cwd))).stdout).toContain('stale evidence: 1');
  });
});
