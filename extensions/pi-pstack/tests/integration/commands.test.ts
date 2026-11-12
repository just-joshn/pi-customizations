import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { auditRun, hardLinkCheck, parsePstackArgs, parseTodo, registerPstackCommand, report } from '../../src/commands.ts';
import { recordReceipt } from '../../src/evidence.ts';
import { type RunId, readHostState } from '../../src/run-files.ts';
import { registerStyle } from '../../src/style.ts';
import { spawnAssignment, workerSocket } from '../../src/workers.ts';
import { type FakePi, fakePi, stopWorkers } from './fake-pi.ts';

let root: string;
let project: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-cmd-')));
  project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: project });
});
afterEach(async () => {
  await stopWorkers(project);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

function withCommand(options: Parameters<typeof fakePi>[0] & { conflicts?: { name: string; owner: string }[] } = { cwd: '' }): FakePi {
  const fake = fakePi({ ...options, cwd: project, session: options.session ?? SessionManager.create(project, join(root, 'sessions')) });
  registerStyle(fake.pi);
  registerPstackCommand(fake.pi, { conflicts: () => options.conflicts ?? [] });
  return fake;
}

function makeRun(runId: string, parentSessionFile: string | null): string {
  const runRoot = join(project, '.pi', 'pstack', 'runs', runId);
  mkdirSync(join(runRoot, 'workers'), { recursive: true });
  writeFileSync(join(runRoot, 'run.json'), JSON.stringify({ schemaVersion: 1, runId, title: 'test run', playbook: 'feature', upstreamRevision: 'x', createdAt: new Date().toISOString(), parentSessionFile, inputCommit: null }));
  return runRoot;
}

async function spawnSleeper(runId: string, workerId: string): Promise<void> {
  const dir = join(project, '.pi', 'pstack', 'runs', runId, 'workers', workerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'assignment.json'),
    JSON.stringify({
      schemaVersion: 1,
      runId,
      workerId,
      kind: 'watch',
      role: 'watcher',
      model: 'inherit-parent',
      thinkingLevel: null,
      workspace: { mode: 'readonly', path: project },
      skills: [],
      watch: { argv: ['sleep', '120'], cwd: project },
    }),
  );
  await spawnAssignment(project, runId as RunId, join(dir, 'assignment.json'));
}

describe('parsePstackArgs', () => {
  test.for([
    ['', { kind: 'status' }],
    ['on', { kind: 'on' }],
    ['doctor', { kind: 'doctor' }],
    ['pause run-1', { kind: 'pause', runId: 'run-1' }],
    ['audit run-1', { kind: 'audit', runId: 'run-1' }],
    ['automation start nightly', { kind: 'automation', action: 'start', name: 'nightly' }],
    ['pause', { kind: 'usage', error: '/pstack pause takes one run id' }],
    ['resume Bad_Id', { kind: 'usage', error: expect.stringContaining('runId') }],
    ['automation start', { kind: 'usage', error: expect.stringContaining('start, stop, or status') }],
    ['bogus', { kind: 'usage', error: 'Unknown /pstack subcommand: bogus' }],
  ] as const)('%s', ([args, expected]) => {
    expect(parsePstackArgs(args)).toEqual(expected);
  });

  test('a usage error is reported as an error with the usage line', async () => {
    const notice = await withCommand().pstack('bogus');
    expect(notice).toEqual({ level: 'error', text: expect.stringMatching(/^Unknown \/pstack subcommand: bogus\nUsage: \/pstack on \| off/) });
  });
});

describe('status and doctor', () => {
  test('status reports the style and this project runs', async () => {
    const fake = withCommand();
    makeRun('mine', fake.session.getSessionFile() ?? null);
    makeRun('theirs', '/elsewhere.jsonl');
    expect((await fake.pstack('status')).text).toBe(
      `pstack style: off (poteto-mode from ${join(realpathSync(join(import.meta.dirname, '../..')), 'generated/skills/poteto-mode/SKILL.md')}).\nRuns in ${project}: 2, 1 owned by this session. /pstack workers lists them.`,
    );
    await fake.pstack('on');
    expect((await fake.pstack('status')).text).toMatch(/^pstack style: on/);
  });

  test('doctor reports tmux, pi, containers, models, MCP, skills, the upstream lock, hard links, and slash conflicts', async () => {
    const fake = withCommand({ cwd: '', toolNames: ['mcp__linear__search', 'mcp__linear__get', 'mcp__sentry__issues', 'read'], conflicts: [{ name: 'how', owner: 'extension command /how (x.ts)' }] });
    const { text, level } = await fake.pstack('doctor');
    expect(level).toBe('info');
    expect(text).toMatch(/^tmux: tmux \d/m);
    expect(text).toMatch(/^pi: \d+\.\d+\.\d+/m);
    expect(text).toMatch(/^container engine: /m);
    expect(text).toMatch(/^models\.json: (missing|valid|INVALID) at /m);
    expect(text).toMatch(/^role resolution: skipped, the session has no model/m);
    expect(text).toContain('MCP servers: linear, sentry');
    expect(text).toContain('generated skills: 62 (62 loaded from');
    expect(text).toContain('upstream lock: a5539b15a3d56e04992565aafee2b37051329ce3');
    expect(text).toContain(`hard links: supported at ${project}`);
    expect(text).toContain('slash names: 1 conflict(s), use /pstack:<name>\n  /how is extension command /how (x.ts); use /pstack:how');
    expect(existsSync(join(project, '.pi'))).toBe(false);
  });

  test('the hard-link check probes the nearest existing directory and leaves nothing behind', () => {
    expect(hardLinkCheck(join(project, '.pi', 'pstack', 'runs'))).toBe(`hard links: supported at ${project}`);
    expect(execFileSync('git', ['status', '--porcelain', '--ignored'], { cwd: project, encoding: 'utf8' })).toBe('');
  });
});

describe('workers, pause, resume', () => {
  test('workers lists runs and workers with state and attach commands', async () => {
    const fake = withCommand();
    makeRun('cmd-list', fake.session.getSessionFile() ?? null);
    await spawnSleeper('cmd-list', 'sleeper');
    const { text } = await fake.pstack('workers');
    expect(text).toMatch(new RegExp(`^cmd-list "test run" \\(owner: this session\\)\\n  sleeper \\(watch, watcher\\): (idle|running); attach: tmux -L ${workerSocket()} attach -t pstack_cmd-list_sleeper_[0-9a-f]{8}$`));
  });

  test('pause records the pause, stops live workers with abort semantics, and keeps a dirty worktree; resume reconciles', async () => {
    const fake = withCommand();
    const runRoot = makeRun('cmd-pause', fake.session.getSessionFile() ?? null);
    await spawnSleeper('cmd-pause', 'sleeper');
    const worktree = join(runRoot, 'workers', 'sleeper', 'worktree');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'scratch', worktree], { cwd: project });
    writeFileSync(join(worktree, 'wip.txt'), 'unsaved work');
    const paused = await fake.pstack('pause cmd-pause');
    expect(paused).toEqual({
      level: 'info',
      text: `Paused run cmd-pause. Its workers were stopped; their worktrees and session files stay on disk.\n  sleeper: stopped; uncommitted changes kept in ${worktree}\nResume with /pstack resume cmd-pause.`,
    });
    expect(readHostState(join(runRoot, 'workers', 'sleeper'))?.phase).toBe('stopped');
    expect(readFileSync(join(worktree, 'wip.txt'), 'utf8')).toBe('unsaved work');
    const kinds = readFileSync(join(runRoot, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).kind);
    expect(kinds.indexOf('pause')).toBeLessThan(kinds.lastIndexOf('abort'));
    expect((await fake.pstack('workers')).text).toContain('(owner: this session, paused)');
    const resumed = await fake.pstack('resume cmd-pause');
    expect(resumed.text).toBe('Resumed run cmd-pause. Workers:\n  sleeper: stopped; respawn its remaining work under a fresh worker id with a consolidated brief');
    expect(fake.sent.at(-1)).toMatchObject({ message: { customType: 'pstack-run', details: { runId: 'cmd-pause', action: 'resume' } }, options: { triggerTurn: true, deliverAs: 'followUp' } });
    expect((await fake.pstack('workers')).text).not.toContain('paused');
  });

  test('only the run owner session may pause it, and automation runs are refused', async () => {
    const fake = withCommand();
    makeRun('other', '/elsewhere.jsonl');
    makeRun('auto', null);
    expect(await fake.pstack('pause other')).toEqual({ level: 'error', text: expect.stringContaining('belongs to session /elsewhere.jsonl, not this one') });
    expect(await fake.pstack('pause auto')).toEqual({ level: 'error', text: expect.stringContaining('belongs to an automation adapter') });
    expect(await fake.pstack('pause missing')).toEqual({ level: 'error', text: expect.stringContaining('Run missing has no run.json') });
  });
});

describe('audit', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  function receipt(runRoot: string, id: string, target: string, artifact: string, digest: string) {
    const path = join(runRoot, `${id}.receipt.json`);
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, id, runId: 'audit-run', target, kind: 'test', verdict: 'pass', commit: null, environment: 'test', artifacts: [{ path: artifact, sha256: digest }], createdAt: new Date().toISOString() }),
    );
    recordReceipt(runRoot, 'audit-run' as RunId, path);
  }

  test('parseTodo reads states, evidence on nested lines, and skip reasons', () => {
    expect(parseTodo('# T\n\n## Original playbook steps\n- [x] 1. Do it.\n   nested (evidence: r1)\n- [ ] 2. Next.\n- [~] 3. Maybe. (skip: not needed)\n\n## Task-specific work\n- [X] Own step (evidence: a, b)\n')).toEqual([
      { state: 'done', title: '1. Do it.', evidence: ['r1'], skip: null },
      { state: 'open', title: '2. Next.', evidence: [], skip: null },
      { state: 'skipped', title: '3. Maybe. (skip: not needed)', evidence: [], skip: 'not needed' },
      { state: 'done', title: 'Own step (evidence: a, b)', evidence: ['a', 'b'], skip: null },
    ]);
  });

  test('audit checks each done step against its receipts with pstack_evidence verify', async () => {
    const fake = withCommand();
    const runRoot = makeRun('audit-run', fake.session.getSessionFile() ?? null);
    mkdirSync(join(runRoot, 'evidence'));
    writeFileSync(join(runRoot, 'evidence', 'ok.txt'), 'ok');
    writeFileSync(join(runRoot, 'evidence', 'changed.txt'), 'before');
    receipt(runRoot, 'r-ok', 'step-1', 'evidence/ok.txt', sha('ok'));
    receipt(runRoot, 'r-bad', 'step-2', 'evidence/changed.txt', sha('before'));
    writeFileSync(join(runRoot, 'evidence', 'changed.txt'), 'after');
    writeFileSync(
      join(runRoot, 'TODO.md'),
      '# T\n\n## Original playbook steps\n- [x] 1. Proven. (evidence: r-ok)\n- [x] 2. Tampered. (evidence: r-bad)\n- [x] 3. Claimed. (evidence: r-none)\n- [x] 4. Asserted.\n- [ ] 5. Open.\n- [~] 6. Skipped. (skip: no UI)\n',
    );
    expect(auditRun(runRoot, 'audit-run' as RunId).map((line) => line.verdict)).toEqual(['pass', 'fail', 'inconclusive', 'inconclusive', 'open', 'skipped']);
    const { text } = await fake.pstack('audit audit-run');
    expect(text.split('\n')).toEqual([
      'Audit of run audit-run: 1 proven, 1 failed, 2 unproven, 1 open, 1 skipped.',
      '[x] pass 1. Proven. (evidence: r-ok)',
      '    r-ok -> step-1: pass',
      '[x] FAIL 2. Tampered. (evidence: r-bad)',
      '    r-bad -> step-2: fail (r-bad: artifact evidence/changed.txt does not match its sha256)',
      '[x] UNPROVEN 3. Claimed. (evidence: r-none)',
      '    receipt r-none is not recorded',
      '[x] UNPROVEN 4. Asserted.',
      '    marked done with no evidence receipt',
      '[ ] 5. Open.',
      '[~] 6. Skipped. (skip: no UI)',
      '    skip: no UI',
    ]);
  });
});

describe('report in each run mode', () => {
  const ctxFor = (mode: string, notices: string[]) => ({ mode, ui: { notify: (text: string) => notices.push(text) } }) as never;

  test('a TUI or RPC session notifies, as before', () => {
    const notices: string[] = [];
    const sent: unknown[] = [];
    report({ sendMessage: (message: unknown) => sent.push(message) } as never, ctxFor('tui', notices), 'doctor ok', 'info');
    expect([notices, sent]).toEqual([['doctor ok'], []]);
  });

  test('--mode json carries the report as a message in the event stream, not on stdout', () => {
    const notices: string[] = [];
    const sent: unknown[] = [];
    report({ sendMessage: (message: unknown) => sent.push(message) } as never, ctxFor('json', notices), 'pstack doctor', 'info');
    expect(notices).toEqual([]);
    expect(sent).toEqual([{ customType: 'pstack-report', content: 'pstack doctor', display: true, details: { level: 'info' } }]);
  });

  test('pi -p writes the report to stdout and an error to stderr', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const notices: string[] = [];
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import { report } from ${JSON.stringify(new URL('../../src/commands.ts', import.meta.url).href)}; report({}, { mode: 'print' }, 'pstack doctor report', 'info');`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    expect(out).toBe('pstack doctor report\n');
    report({} as never, ctxFor('print', notices), 'bad usage', 'error');
    expect([err.mock.calls, notices]).toEqual([[['bad usage']], []]);
    err.mockRestore();
  });
});
