import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { localShell } from '../../src/adapters/shell.ts';
import { type CliContext, runCli } from '../../src/cli/commands.ts';
import { fixedClock } from '../support/clock.ts';
import { NO_HOST, testContext } from '../support/context.ts';
import { fixturePath, loadSources } from '../unit/support.ts';
import { git, tempRepo, writeAndCommit } from './repo.ts';

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

const FAQ = 'The skills leaderboard is powered by anonymous telemetry data from the skills CLI. The telemetry only tracks aggregate skill installation counts.';

const HEAD = 'f'.repeat(40);

const USER_ONLY = new Set(['grill-me', 'grill-with-docs', 'improve-codebase-architecture', 'setup-matt-pocock-skills', 'handoff', 'triage', 'teach']);

// Upstream skill bodies are never copied into this repository, so the fake web serves a minimal frontmatter per locked path.
function fakeWeb(page = PAGE): { readonly urls: string[]; readonly fetchText: CliContext['fetchText'] } {
  const urls: string[] = [];
  const paths = new Map(Object.entries(loadSources()).map(([name, pin]) => [`https://raw.githubusercontent.com/${pin.repository}/${HEAD}/${pin.path}`, name]));
  const fetchText = (url: string): Promise<string> => {
    urls.push(url);
    if (url === 'https://skills.sh/') return Promise.resolve(page);
    if (url === 'https://skills.sh/docs/faq') return Promise.resolve(FAQ);
    const name = paths.get(url);
    if (name === undefined) return Promise.reject(new Error(`unexpected fetch ${url}`));
    return Promise.resolve(`---\nname: ${name}\n${USER_ONLY.has(name) ? 'disable-model-invocation: true\n' : ''}---\nbody\n`);
  };
  return { urls, fetchText };
}

function liveContext(cwd: string, page = PAGE): CliContext & { readonly urls: readonly string[] } {
  const web = fakeWeb(page);
  const local = localShell(cwd, undefined);
  const shell: CliContext['shell'] = (cmd, args) => (args[0] === 'ls-remote' ? Promise.resolve({ stdout: `${HEAD}\tHEAD\n`, stderr: '', exitCode: 0 }) : local(cmd, args));
  return { cwd, clock: fixedClock(), fetchText: web.fetchText, shell, host: NO_HOST, urls: web.urls };
}

const OFFLINE_REFRESH = ['registry', 'refresh', '--from', 'leaderboard.2026-10-07.json', '--sources', 'skill-sources.2026-10-07.json'];

function context(cwd: string): CliContext {
  return testContext(cwd);
}

describe('registry commands', () => {
  test('live refresh resolves every locked skill at upstream HEAD', async () => {
    const live = liveContext(repo());
    const result = await runCli(['registry', 'refresh'], live);
    expect([result, live.urls.slice(0, 2), live.urls.length]).toEqual([{ code: 0, stdout: 'locked 18 skills at 2026-10-07T00:00:00.000Z\n' }, ['https://skills.sh/docs/faq', 'https://skills.sh/'], 20]);
  });

  test('live refresh drops an optional skill that fails to resolve', async () => {
    const live = liveContext(repo());
    const fetchText: CliContext['fetchText'] = (url) => (url.endsWith('/teach/SKILL.md') ? Promise.reject(new Error(`404 ${url}`)) : live.fetchText(url));
    expect(await runCli(['registry', 'refresh'], { ...live, fetchText })).toEqual({ code: 0, stdout: 'locked 17 skills at 2026-10-07T00:00:00.000Z; dropped optional teach\n' });
  });

  test('live refresh records the resolved commit with its policy', async () => {
    const live = liveContext(repo());
    await runCli(['registry', 'refresh'], live);
    const lock = JSON.parse(readFileSync(join(live.cwd, '.s50/registry.lock.json'), 'utf8'));
    const triage = lock.snapshot.skills.find((skill: { readonly name: string }) => skill.name === 'triage');
    expect([lock.schemaVersion, lock.kind, triage.lock.commit, triage.invocationPolicy]).toEqual([1, 'approved', HEAD, 'user']);
  });

  test('refresh fails when the page format changes', async () => {
    expect(await runCli(['registry', 'refresh'], liveContext(repo(), '<html></html>'))).toEqual({ code: 1, stdout: 'leaderboard initialSkills payload not found\n' });
  });

  test('show lists locked skills with rank, source, policy, commit', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh'], liveContext(cwd));
    const shown = await runCli(['registry', 'show'], context(cwd));
    expect(shown.stdout.split('\n').slice(0, 3)).toEqual(['snapshot 2026-10-07T00:00:00.000Z from https://skills.sh/', '1 vercel-labs/skills/find-skills model fffffff', '2 mattpocock/skills/grill-me user fffffff']);
  });

  test('verify accepts a fresh lock', async () => {
    const cwd = repo();
    await runCli(['registry', 'refresh'], liveContext(cwd));
    expect(await runCli(['registry', 'verify'], context(cwd))).toEqual({ code: 0, stdout: 'registry lock verified\n' });
  });

  test('show without a lock is blocked', async () => {
    expect(await runCli(['registry', 'show'], context(repo()))).toEqual({ code: 2, stdout: 'no registry lock\n' });
  });

  test('a corrupt lock is reported invalid', async () => {
    const cwd = repo();
    await runCli(OFFLINE_REFRESH, context(cwd));
    writeFileSync(join(cwd, '.s50/registry.lock.json'), '{}');
    expect((await runCli(['registry', 'verify'], context(cwd))).stdout).toMatch(/^invalid registry lock: /);
  });
});

describe('run commands', () => {
  async function started(): Promise<string> {
    const cwd = repo();
    await runCli(OFFLINE_REFRESH, context(cwd));
    await runCli(['feature', 'export invoices', '--criteria', 'csv lists invoices', '--installed', 'grilling,codebase-design,tdd'], context(cwd));
    return cwd;
  }

  test('installing the missing skill clears its gate on the next command', async () => {
    const cwd = repo();
    const installed: { name: string; contentHash: string | null }[] = [];
    const host: CliContext['host'] = { installedSkills: async () => installed, capabilities: () => ({}) };
    const withHost = { ...context(cwd), host };
    await runCli(OFFLINE_REFRESH, withHost);
    expect((await runCli(['feature', 'export invoices', '--criteria', 'csv lists invoices'], withHost)).code).toBe(3);
    installed.push(...['grilling', 'domain-modeling', 'codebase-design', 'tdd'].map((name) => ({ name, contentHash: null })));
    expect((await runCli(['resume'], withHost)).stdout.trim().split('\n').at(-1)).toBe('{"kind":"advance","to":"CLASSIFY"}');
  });

  test('verify lists missing evidence with blockers', async () => {
    const result = await runCli(['verify'], context(await started()));
    expect(result.code).toBe(2);
    expect(result.stdout.split('\n').slice(0, 2)).toEqual(['consumer route: drive_executable', 'MISSING csv lists invoices']);
  });

  test.fails('status lists the preflight risks', async () => {
    const cwd = await started();
    const run = JSON.parse(readFileSync(join(cwd, '.s50/run.json'), 'utf8'));
    run.risks = ['a dirty tree at preflight', 'no test command found'];
    writeFileSync(join(cwd, '.s50/run.json'), JSON.stringify(run));
    expect((await runCli(['status'], context(cwd))).stdout).toContain('risks: a dirty tree at preflight; no test command found');
  });

  test('explain ends with the next action', async () => {
    const lines = (await runCli(['explain'], context(await started()))).stdout.trim().split('\n');
    expect(lines.at(-1)).toBe('next: invoke skill grilling');
  });

  test.for([['--criteria', ''], ['--criteria', ';'], ['--criteria']])('a start with empty %j is refused', async (flags) => {
    const cwd = repo();
    await runCli(OFFLINE_REFRESH, context(cwd));
    expect(await runCli(['feature', 'x', ...flags], context(cwd))).toEqual({ code: 2, stdout: '--criteria needs at least one criterion\n' });
  });

  test('a second start is refused while a run exists', async () => {
    expect(await runCli(['bug', 'again'], context(await started()))).toEqual({ code: 2, stdout: 'a run already exists in .s50/; use s50 resume\n' });
  });

  test('start without a registry lock is blocked', async () => {
    expect(await runCli(['feature', 'x'], context(repo()))).toEqual({ code: 2, stdout: 'no .s50/registry.lock.json; run s50 registry refresh first\n' });
  });

  test('an unknown consumer kind is rejected', async () => {
    const cwd = repo();
    await runCli(OFFLINE_REFRESH, context(cwd));
    expect(await runCli(['feature', 'x', '--consumer', 'fax:machine'], context(cwd))).toEqual({
      code: 1,
      // biome-ignore lint/security/noSecrets: the CLI's consumer-kind usage text
      stdout: '--consumer kind must be one of browser|electron|cli|tui|http|rpc|library|native\n',
    });
  });

  test('malformed capabilities JSON is rejected', async () => {
    const cwd = repo();
    await runCli(OFFLINE_REFRESH, context(cwd));
    expect((await runCli(['feature', 'x', '--capabilities', '{'], context(cwd))).stdout).toMatch(/^--capabilities: /);
  });

  test('apply rejects invalid JSON at the boundary', async () => {
    expect((await runCli(['apply', '{'], context(await started()))).stdout).toMatch(/^invalid JSON: /);
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

  const EVIDENCE = { claim: 'csv', criterion: 'csv lists invoices', state: 'MEASURED', dependencies: ['src/export/**'], method: 'cli', expected: 'rows', observed: 'rows', artifact: 'a.log' };

  test('a run in a subdirectory stales evidence on its own paths', async () => {
    const root = repo();
    const cwd = join(root, 'pkg');
    writeAndCommit(root, { 'pkg/src/export/csv.ts': 'export const csv = 1;\n' }, 'pkg');
    for (const name of ['leaderboard.2026-10-07.json', 'skill-sources.2026-10-07.json']) writeFileSync(join(cwd, name), readFileSync(join(root, name)));
    await runCli(OFFLINE_REFRESH, context(cwd));
    await runCli(['feature', 'export invoices', '--criteria', 'csv lists invoices', '--installed', 'grilling,codebase-design,tdd'], context(cwd));
    await runCli(['apply', JSON.stringify({ kind: 'record_evidence', evidence: EVIDENCE })], context(cwd));
    writeAndCommit(root, { 'pkg/src/export/csv.ts': 'export const csv = 2;\n' }, 'edit');
    expect((await runCli(['resume'], context(cwd))).stdout).toContain('stale evidence: 1');
  });

  test('status follows a commit made after the last command', async () => {
    const cwd = await started();
    await runCli(['apply', JSON.stringify({ kind: 'record_evidence', evidence: EVIDENCE })], context(cwd));
    writeAndCommit(cwd, { 'src/export/csv.ts': 'export const csv = 2;\n' }, 'edit');
    expect((await runCli(['status'], context(cwd))).stdout).toContain('stale evidence: 1');
  });

  test('verify follows a commit made after the last command', async () => {
    const cwd = await started();
    await runCli(['apply', JSON.stringify({ kind: 'record_evidence', evidence: EVIDENCE })], context(cwd));
    writeAndCommit(cwd, { 'src/export/csv.ts': 'export const csv = 2;\n' }, 'edit');
    expect((await runCli(['verify'], context(cwd))).stdout.split('\n')[1]).toBe('MISSING csv lists invoices');
  });
});

describe('help', () => {
  test.for(['help', '--help', '-h'])('%s prints usage and exits 0', async (flag) => {
    const result = await runCli([flag], context(repo()));
    expect([result.code, result.stdout.split('\n')[0]]).toEqual([0, 'usage: s50 <command>']);
  });

  test('an unknown command is named before the usage', async () => {
    const result = await runCli(['bogus'], context(repo()));
    expect([result.code, result.stdout.split('\n')[0]]).toEqual([1, 'unknown command: bogus']);
  });
});
