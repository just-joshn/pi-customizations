import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SKILLS_DIR } from '../src/paths.ts';

const SCRIPTS = join(SKILLS_DIR, 'poteto-mode/scripts');
let scratch = '';
beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-scripts-')));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('bundled scripts run from the package (SCRIPT-001)', () => {
  test("upstream's own test script (orch, watch-pr, check-plan) passes once the CLIs' bootstrap has installed their dependencies", () => {
    const bootstrap = spawnSync('bun', ['-e', "(await import('./bootstrap.ts')).ensureDependenciesInstalled()"], { cwd: SCRIPTS, encoding: 'utf8', timeout: 120_000 });
    expect(bootstrap.status).toBe(0);
    const result = spawnSync('bun', ['run', 'test'], { cwd: SCRIPTS, encoding: 'utf8', timeout: 120_000 });
    expect(result.stderr).toMatch(/\n 68 pass\n 0 fail\n/);
    expect(result.status).toBe(0);
  });

  test('watch-pr and orch start and print usage', () => {
    const watch = spawnSync(join(SCRIPTS, 'watch-pr/watch-pr'), ['--help'], { encoding: 'utf8', timeout: 60_000 });
    expect(watch.stdout.split('\n')[0]).toBe('Usage: watch-pr [options]');
    const orch = spawnSync(join(SCRIPTS, 'orch/orch.ts'), ['--help'], { encoding: 'utf8', timeout: 60_000 });
    expect(orch.stdout).toMatch(/^Usage: orch /);
    expect([watch.status, orch.status]).toEqual([0, 0]);
  });

  test('check-plan reports a plan that lacks the required sections', () => {
    writeFileSync(join(scratch, 'plan.md'), '# Plan\n\n## PR 1: do a thing\n\n- [ ] one box\n');
    const result = spawnSync(join(SCRIPTS, 'check-plan.mjs'), [join(scratch, 'plan.md')], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout.trim().split('\n').at(-1)).toMatch(/^\d+ PR sections, [1-9]\d* problems$/);
  });

  test('log.sh writes the header once and neutralizes formula and tab characters', () => {
    const log = join(scratch, 'trail/decisions.tsv');
    const script = join(SKILLS_DIR, 'show-me-your-work/scripts/log.sh');
    execFileSync(script, [log, 'frame', 'counted\tthe work', 'size first', 'commit abc', '=SUM(A1)']);
    execFileSync(script, [log, 'build', 'shipped', 'tests\ngreen', '-', 'ok']);
    const [header, first, second] = readFileSync(log, 'utf8').trim().split('\n');
    expect(header).toBe('ts\tphase\tdecision\twhy\tevidence\tresult');
    expect(first?.split('\t').slice(1)).toEqual(['frame', 'counted the work', 'size first', 'commit abc', "'=SUM(A1)"]);
    expect(second?.split('\t').slice(1)).toEqual(['build', 'shipped', 'tests green', "'-", 'ok']);
  });
});

describe('statechart.mjs runs from the package (SCRIPT-001)', () => {
  const STATECHART = join(SKILLS_DIR, 'statechart/scripts');

  test('--help prints the commands and exits 0', () => {
    const result = spawnSync('node', [join(STATECHART, 'statechart.mjs'), '--help'], { encoding: 'utf8', timeout: 60_000 });
    expect(result.stdout.split('\n')[0]).toBe('Usage: node statechart.mjs from-spec SPEC.tla [--fixed FIXED.tla | --against AGREED.tla] [--label TEXT] [--map FILE] [--expect-broken RULE]... [--title TEXT] [--out DIR] [--png]');
    expect(result.status).toBe(0);
  });

  test('from-spec without TLA2TOOLS says where to get TLC, exits 2, and writes nothing', () => {
    cpSync(join(STATECHART, 'model'), scratch, { recursive: true });
    const { TLA2TOOLS: _unset, ...env } = process.env;
    const result = spawnSync('node', [join(STATECHART, 'statechart.mjs'), 'from-spec', join(scratch, 'OutputFolder.tla')], { encoding: 'utf8', env, timeout: 60_000 });
    expect(result.stderr).toBe('Cannot find TLC. Download tla2tools.jar from a TLA+ release:\n  https://github.com/tlaplus/tlaplus/releases\nThen set TLA2TOOLS to the path of tla2tools.jar, and JAVA to a java binary (Java 11 or later).\n');
    expect(result.status).toBe(2);
    expect(readdirSync(scratch).toSorted()).toEqual(['OutputFolder.cfg', 'OutputFolder.map.mjs', 'OutputFolder.tla']);
  });
});

describe.skipIf(process.platform !== 'darwin')('worktree-audit.sh reads Pi transcripts (WTA-001; the upstream script uses BSD stat and date)', () => {
  function auditRow(setup: (paths: { worktree: string; agentDir: string; home: string; repo: string }) => void, extraEnv: Record<string, string> = {}): string[] {
    const repo = join(scratch, 'repo');
    const worktree = join(scratch, 'wt');
    const agentDir = join(scratch, 'agent');
    const home = join(scratch, 'home');
    const bin = join(scratch, 'bin');
    for (const dir of [repo, agentDir, home, bin]) mkdirSync(dir, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    git('worktree', 'add', '-q', '-b', 'feature', worktree);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bin, 'gh'), 0o755);
    setup({ worktree, agentDir, home, repo });
    // The repo has no origin, so the MERGED base is named explicitly, as upstream 0.15.20 requires.
    const output = execFileSync('bash', [join(SCRIPTS, 'worktree-audit.sh'), '-b', 'main', repo], {
      encoding: 'utf8',
      // The upstream script calls BSD `stat -f` and `date -r`, so macOS's /usr/bin and /bin tools go first.
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir, PATH: `${bin}:/usr/bin:/bin:${process.env['PATH'] ?? ''}`, ...extraEnv },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const row = output.split('\n').find((line) => line.endsWith(`\t${worktree}`));
    if (row === undefined) throw new Error(`no audit row for ${worktree}:\n${output}`);
    return row.split('\t');
  }

  const today = () => execFileSync('/bin/date', ['+%Y-%m-%d'], { encoding: 'utf8' }).trim();
  const piSlug = (path: string) => `--${path.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`;

  test('a Pi session that worked in the worktree makes it a recent chat', () => {
    const row = auditRow(({ worktree, agentDir }) => {
      const dir = join(agentDir, 'sessions', piSlug(worktree));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '2026-10-12T00-00-00-000Z_s.jsonl'), `${JSON.stringify({ type: 'session', cwd: worktree })}\n`);
    });
    expect(row.slice(6, 8)).toEqual([today(), 'verify-recent-chat']);
  });

  test('a pi-pstack subagent transcript from the main checkout counts too (review: parity 4)', () => {
    const row = auditRow(({ worktree, agentDir, repo }) => {
      const dir = join(agentDir, 'pstack/workspaces', piSlug(repo), 'subagents');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '2026-10-12T00-00-00-000Z_11111111-2222-4333-8444-555555555555.jsonl'), `${JSON.stringify({ type: 'message', message: { content: `cd ${worktree}/src` } })}\n`);
    });
    expect(row.slice(6, 8)).toEqual([today(), 'verify-recent-chat']);
  });

  test('a custom session directory from PI_CODING_AGENT_SESSION_DIR is searched (review: parity 4)', () => {
    const sessions = join(scratch, 'custom-sessions');
    const row = auditRow(
      ({ worktree }) => {
        mkdirSync(sessions, { recursive: true });
        writeFileSync(join(sessions, '2026-10-12T00-00-00-000Z_s.jsonl'), `${JSON.stringify({ type: 'session', cwd: worktree })}\n`);
      },
      { PI_CODING_AGENT_SESSION_DIR: sessions },
    );
    expect(row.slice(6, 8)).toEqual([today(), 'verify-recent-chat']);
  });

  test('a settings sessionDir that starts with ~ is expanded (recheck)', () => {
    const row = auditRow(({ worktree, agentDir, home }) => {
      const sessions = join(home, 'my-sessions');
      mkdirSync(sessions, { recursive: true });
      writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ sessionDir: '~/my-sessions' }));
      writeFileSync(join(sessions, '2026-10-12T00-00-00-000Z_s.jsonl'), `${JSON.stringify({ type: 'session', cwd: worktree })}\n`);
    });
    expect(row.slice(6, 8)).toEqual([today(), 'verify-recent-chat']);
  });

  test('PI_CODING_AGENT_SESSION_DIR is tilde-expanded like Pi does (recheck)', () => {
    const row = auditRow(
      ({ worktree, home }) => {
        const sessions = join(home, 'env-sessions');
        mkdirSync(sessions, { recursive: true });
        writeFileSync(join(sessions, '2026-10-12T00-00-00-000Z_s.jsonl'), `${JSON.stringify({ type: 'session', cwd: worktree })}\n`);
      },
      { PI_CODING_AGENT_SESSION_DIR: '~/env-sessions' },
    );
    expect(row.slice(6, 8)).toEqual([today(), 'verify-recent-chat']);
  });

  test('a project .pi/settings.json sessionDir wins over the global one and resolves from the working directory (recheck)', () => {
    const row = auditRow(({ worktree, agentDir, repo }) => {
      writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ sessionDir: join(agentDir, 'unused') }));
      mkdirSync(join(repo, '.pi/sessions'), { recursive: true });
      writeFileSync(join(repo, '.pi/settings.json'), JSON.stringify({ sessionDir: '.pi/sessions' }));
      writeFileSync(join(repo, '.pi/sessions/2026-10-12T00-00-00-000Z_s.jsonl'), `${JSON.stringify({ type: 'session', cwd: worktree })}\n`);
    });
    expect(row.slice(6, 8)).toEqual([today(), 'verify-recent-chat']);
  });

  test('PI_CODING_AGENT_DIR is tilde-expanded like Pi does (review r2: security)', () => {
    const row = auditRow(
      ({ worktree, home }) => {
        const dir = join(home, 'tilde-agent/sessions', piSlug(worktree));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, '2026-10-12T00-00-00-000Z_s.jsonl'), `${JSON.stringify({ type: 'session', cwd: worktree })}\n`);
      },
      { PI_CODING_AGENT_DIR: '~/tilde-agent' },
    );
    expect(row.slice(6, 8)).toEqual([today(), 'verify-recent-chat']);
  });

  test('a Cursor transcript no longer counts', () => {
    const row = auditRow(({ worktree, home }) => {
      const dir = join(home, '.cursor/projects', worktree.replace(/^\//, '').replace(/\//g, '-'), 'agent-transcripts');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'x.jsonl'), `${JSON.stringify({ cwd: worktree })}\n`);
    });
    // No chat counts, and the worktree's HEAD is already on main, so upstream buckets it safe.
    expect(row.slice(6, 8)).toEqual(['-', 'safe']);
  });
});
