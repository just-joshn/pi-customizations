import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { claimWake, excerpt, type JobSpec, launch, launchBrokered, list, newJobId, outputPath, read, request, STOPPED_EXIT_CODE, stop, tail, tmuxSocket } from '../src/jobs.ts';
import { bwrapArgs, SANDBOX_ENV, type SandboxPolicy, sandboxed, seatbeltProfile, TOP_DIR_ENV } from '../src/sandbox.ts';

const owner = `test${process.pid}`;
const socket = tmuxSocket(owner);
const TAIL_LINES = 5;
const SPAWN_FAILURE_EXIT_CODE = 127;
const BROKERED_EXIT_CODE = 4;
const WHOLE_REPORT_BYTES = 100;
const ACCENT_REPEATS = 50;
const FILLER_REPEATS = 1000;
const EURO_REPEATS = 20;
const EXCERPT_HEAD_BYTES = 16;
const EXCERPT_TAIL_BYTES = 22;
const EURO_TAIL_REPEATS = 6;
const SAMPLE_UID = 501;
const BWRAP_PREFIX_ARGS = 3;
const ESCAPER_BASE_SECONDS = 40_000;
const ESCAPER_JITTER_SECONDS = 10_000;
const CONTAINMENT_TIMEOUT_MS = 20_000;
const SETTLE_TIMEOUT_MS = 10_000;
const SHORT_POLL_TIMEOUT_MS = 5_000;
const BUS_TAIL_LINES = 3;
let root: string;

const spec = (command: string, overrides: Partial<JobSpec> = {}): JobSpec => {
  const id = overrides.id ?? newJobId('t');
  return {
    id,
    name: 't',
    kind: 'command',
    cwd: root,
    argv: ['bash', '-c', command],
    command: [],
    policy: { writable: [], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir: root, jobDir: root },
    brokered: false,
    owner,
    wake: 'done',
    repeat: false,
    series: id,
    socket,
    sweep: { roots: [], protect: [] },
    out: root,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
};

async function settled(id: string, jobsRoot = root) {
  await expect.poll(() => read(jobsRoot, id, owner)?.status.state, { timeout: SETTLE_TIMEOUT_MS }).not.toBe('running');
  const job = read(jobsRoot, id, owner);
  if (!job) throw new Error(`job ${id} has no spec`);
  return job;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-jobs-')));
});

afterEach(() => {
  try {
    execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // No server was started.
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('tmux jobs', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  test('without tmux a job is refused with a way to fix it, never run another way', () => {
    vi.stubEnv('PATH', '/nonexistent');
    try {
      expect(() => launch(root, spec('true'))).toThrow(/needs tmux/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('a finished command keeps its exit code and output', async () => {
    const job = launch(root, spec('echo hello; exit 3'));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 3 });
    expect(tail(outputPath(done.dir), TAIL_LINES)).toContain('hello');
  });

  test("a finished job's package caches are deleted, while files it left in its temp directory stay for the report", async () => {
    const job = launch(root, spec('mkdir -p "$BUN_INSTALL_CACHE_DIR/pkg" "$GOMODCACHE/mod" && echo x > "$GOMODCACHE/mod/f" && chmod -R a-w "$GOMODCACHE/mod" && echo kept > "$TMPDIR/report.txt"'));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 0 });
    expect(readFileSync(join(done.dir, 'tmp', 'report.txt'), 'utf8')).toBe('kept\n');
    expect([existsSync(join(done.dir, 'tmp', 'bun')), existsSync(join(done.dir, 'tmp', 'go-mod'))]).toEqual([false, false]);
  });

  test('the command sees the sandbox marker so nested jobs do not re-wrap', async () => {
    const job = launch(root, spec(`echo "marker=$${SANDBOX_ENV}"`));
    expect(tail(outputPath((await settled(job.spec.id)).dir), TAIL_LINES)).toContain('marker=1');
  });

});

describe('tmux jobs, wrapper and lifecycle', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  test('the wrapper sweeps with a copy of the sweeper kept in the job directory, since Node will not run types under node_modules', async () => {
    const job = launch(root, spec('true'));
    const script = /'([^']+sweep\.ts)' '[^']*inventory\.json'/.exec(readFileSync(join(job.dir, 'wrapper.sh'), 'utf8'))?.[1];
    expect(script).toBe(join(job.dir, 'sweep.ts'));
    await settled(job.spec.id);
    expect(execFileSync(process.execPath, [script ?? '', join(job.dir, 'inventory.json')], { encoding: 'utf8' })).toBe('');
  });

  test('a job whose tmux server dies still finishes when its sweep fails, instead of hanging on the closed terminal', async () => {
    const job = launch(root, spec('sleep 30'));
    await expect.poll(() => existsSync(join(job.dir, 'wrapper.pid')), { timeout: SHORT_POLL_TIMEOUT_MS }).toBe(true);
    const wrapper = Number(readFileSync(join(job.dir, 'wrapper.pid'), 'utf8'));
    rmSync(join(job.dir, 'inventory.json'));
    execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
    await expect.poll(() => read(root, job.spec.id, owner)?.status, { timeout: SETTLE_TIMEOUT_MS }).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    const alive = (): boolean => {
      try {
        process.kill(wrapper, 0);
        return true;
      } catch {
        return false;
      }
    };
    await expect.poll(alive, { timeout: SHORT_POLL_TIMEOUT_MS }).toBe(false);
  });

  test('stopping a running job records the stopped code without a wake', async () => {
    const job = launch(root, spec('sleep 30'));
    expect(read(root, job.spec.id, owner)?.status).toEqual({ state: 'running' });
    await stop(job);
    const stopped = read(root, job.spec.id, owner);
    expect(stopped?.status).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    expect(stopped && claimWake(stopped)).toBe(false);
  });

  test('a wake is claimed exactly once', async () => {
    const job = await settled(launch(root, spec('true')).spec.id);
    expect([claimWake(job), claimWake(job)]).toEqual([true, false]);
  });

  test('list returns only the owner jobs, oldest first', async () => {
    const first = launch(root, spec('true', { createdAt: '2026-01-01T00:00:00.000Z' }));
    const second = launch(root, spec('true', { createdAt: '2026-01-02T00:00:00.000Z' }));
    launch(root, spec('true', { owner: 'someone-else' }));
    expect(list(root, owner).map((job) => job.spec.id)).toEqual([first.spec.id, second.spec.id]);
  });

  test('a corrupt spec is skipped instead of breaking the listing', () => {
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'job.json'), '{');
    expect(list(root, owner)).toEqual([]);
  });

  test('sessions with a shared id prefix get separate tmux servers', () => {
    expect(tmuxSocket('01a1dd30-aaaa')).not.toBe(tmuxSocket('01a1dd30-bbbb'));
  });
});

describe('jobs a sandboxed macOS worker asks the root to start', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('a worker without its top-level job directory cannot ask for a job', () => {
    vi.stubEnv(TOP_DIR_ENV, '');
    expect(() => request(join(root, 'nested'), spec('true'))).toThrow(/top-level job directory/);
  });

  test('a requested job waits for the root, and stopping it before the root acts records the stopped code without a wake', async () => {
    vi.stubEnv(TOP_DIR_ENV, root);
    const job = request(join(root, 'nested'), spec('true'));
    expect(read(join(root, 'nested'), job.spec.id, owner)?.status).toEqual({ state: 'running' });
    await stop(job);
    expect(read(join(root, 'nested'), job.spec.id, owner)?.status).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    expect(claimWake(job)).toBe(false);
  });

  test('a request the root launches runs to its exit code and output', async () => {
    vi.stubEnv(TOP_DIR_ENV, root);
    const job = request(join(root, 'nested'), spec('echo brokered; exit 4'));
    launchBrokered(root, job.dir, job.spec, job.spec.sweep, ['bash', '-c', 'echo brokered; exit 4'], socket);
    const done = await settled(job.spec.id, join(root, 'nested'));
    expect(done.status).toEqual({ state: 'exited', code: BROKERED_EXIT_CODE });
    expect(tail(outputPath(done.spec.out), TAIL_LINES)).toContain('brokered');
  });

  test('a request the root cannot start ends at once with the reason, instead of running forever', () => {
    vi.stubEnv(TOP_DIR_ENV, root);
    const job = request(join(root, 'nested'), spec('true'));
    vi.stubEnv('PATH', '/nonexistent');
    launchBrokered(root, job.dir, job.spec, job.spec.sweep, ['true'], socket);
    vi.stubEnv('PATH', process.env['PATH'] ?? '');
    const done = read(join(root, 'nested'), job.spec.id, owner);
    expect(done?.status).toEqual({ state: 'exited', code: SPAWN_FAILURE_EXIT_CODE });
    expect(tail(outputPath(done?.spec.out ?? ''), TAIL_LINES)).toMatch(/could not launch this job: .*needs tmux/);
  });
});

describe('reports', () => {
  test('a job named only with symbols still gets a readable id', () => {
    expect(newJobId('***')).toMatch(/^job-[0-9a-f]{6}$/);
    expect(newJobId('Fix: The Bug!')).toMatch(/^fix-the-bug-[0-9a-f]{6}$/);
  });

  test('a job that wrote no output reports nothing rather than failing', () => {
    expect(excerpt(join(root, 'none.log'), 10, 10)).toBe('');
  });

  test('a short output is reported whole', () => {
    writeFileSync(join(root, 'short.log'), 'verdict: PASS\n');
    expect(excerpt(join(root, 'short.log'), WHOLE_REPORT_BYTES, WHOLE_REPORT_BYTES)).toBe('verdict: PASS\n');
  });

  test('a long output keeps its first line and its end, cut on whole characters, and says how much was left out', () => {
    const path = join(root, 'long.log');
    writeFileSync(path, `verdict: FAIL ${'é'.repeat(ACCENT_REPEATS)}${'x'.repeat(FILLER_REPEATS)}${'€'.repeat(EURO_REPEATS)} end`);
    const report = excerpt(path, EXCERPT_HEAD_BYTES, EXCERPT_TAIL_BYTES);
    const [head, note, end] = report.split('\n');
    expect(head).toBe('verdict: FAIL é');
    expect(note).toMatch(new RegExp(`^\\[\\.\\.\\. \\d+ bytes omitted, full output at ${path} \\.\\.\\.\\]$`));
    expect(end).toBe(`${'€'.repeat(EURO_TAIL_REPEATS)} end`);
    const omitted = Number(/(\d+) bytes omitted/.exec(note ?? '')?.[1]);
    expect(Buffer.byteLength(head ?? '') + omitted + Buffer.byteLength(end ?? '')).toBe(readFileSync(path).length);
  });
});

describe('sandbox policy', () => {
  const policy: SandboxPolicy = { writable: ['/work/tree'], protect: ['/work/tree/.git/hooks'], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir: '/home/u/.pi/agent', jobDir: '/home/u/.pi/agent/pstack-v2/jobs/j' };

  test('a platform without a sandbox refuses to run', () => {
    expect(() => sandboxed(['pi'], policy, 'win32', {})).toThrow(/found none on win32/);
  });

  test('seatbelt closes the Pi agent directory, opening only the job credentials copy', () => {
    const credentials = '/home/u/.pi/agent/pstack-v2/jobs/j/agent';
    const profile = seatbeltProfile({ ...policy, credentials });
    expect(profile).toContain('(deny file-write* (subpath "/home/u/.pi/agent"))');
    expect(profile).toContain(`(allow file-write-data (literal "${credentials}/auth.json"))`);
    expect(profile).not.toContain('"/home/u/.pi/agent/auth.json"');
  });

  test('seatbelt opens no write beyond the writable paths when none is inside the agent directory', () => {
    expect(seatbeltProfile(policy)).not.toMatch(/\(allow file-write\* \)/);
  });

  test('bwrap leaves the Pi agent directory read-only and hides outside services', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pstack-agent-'));
    const hidden = mkdtempSync(join(tmpdir(), 'pstack-runtime-'));
    const args = bwrapArgs({ ...policy, writable: [tmpdir()], protect: [], agentDir }, { XDG_RUNTIME_DIR: hidden }, SAMPLE_UID);
    expect(args.slice(0, BWRAP_PREFIX_ARGS)).toEqual(['--ro-bind', '/', '/']);
    expect(args).toEqual(expect.arrayContaining(['--unshare-pid', '--tmpfs', hidden]));
    expect(args.filter((arg, i) => arg === agentDir && args[i - 2] !== '--ro-bind' && args[i - 1] !== '--ro-bind')).toEqual([]);
    rmSync(agentDir, { recursive: true });
    rmSync(hidden, { recursive: true });
  });
});

let home: string;
let agentDir: string;
let work: string;

const jobsIn = () => join(agentDir, 'pstack-v2', 'jobs');
const run = async (command: string, id = newJobId('probe')) => {
  const nested = join(jobsIn(), id, 'nested');
  mkdirSync(nested, { recursive: true });
  const argv = sandboxed(['bash', '-c', command], { writable: [work, nested], protect: [join(work, '.git', 'hooks')], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) }, process.platform, {});
  return settled(launch(jobsIn(), spec('', { id, argv, cwd: work })).spec.id, jobsIn());
};

const useSandboxHome = () => {
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(homedir(), '.pstack-sandbox-')));
    agentDir = join(home, 'agent');
    work = join(home, 'work');
    mkdirSync(join(agentDir, 'extensions'), { recursive: true });
    mkdirSync(join(work, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
};

const supportsSandbox = process.platform === 'darwin' || process.platform === 'linux';

// Each test below reproduces an escape found in review: a sandboxed job reaching an unsandboxed process or file.
// The assertions read host state, since on Linux a write into Pi's agent directory succeeds inside a throwaway overlay.
describe.runIf(supportsSandbox)('sandbox containment', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  useSandboxHome();

  test('a job cannot run a tmux server of its own, since the root starts every job a worker asks for', async () => {
    const id = newJobId('nester');
    const own = join(jobsIn(), id, 'nested', 'tmux.sock');
    await run(`tmux -S ${own} new-session -d 'touch ${work}/nested.txt' && sleep 1; tmux -S ${own} kill-server`, id);
    expect(existsSync(join(work, 'nested.txt'))).toBe(false);
  });

  test('a job writes its working directory but not outside it', async () => {
    await run(`touch ${work}/ok.txt; touch ${home}/outside.txt`);
    expect([existsSync(join(work, 'ok.txt')), existsSync(join(home, 'outside.txt'))]).toEqual([true, false]);
  });

  test('a job cannot run commands through the unsandboxed tmux server', async () => {
    await run(`tmux -S ${socket} new-session -d 'touch ${home}/escaped.txt'; sleep 1`);
    expect(existsSync(join(home, 'escaped.txt'))).toBe(false);
  });

  test('a job cannot swap out Pi extensions or write role lines', async () => {
    await run(`mv ${agentDir}/extensions ${agentDir}/old; echo injected > ${agentDir}/pstack-v2-models.md`);
    expect([existsSync(join(agentDir, 'extensions')), existsSync(join(agentDir, 'old')), existsSync(join(agentDir, 'pstack-v2-models.md'))]).toEqual([true, false, false]);
  });

});

describe.runIf(supportsSandbox)('sandbox containment, agent directory and hooks', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  useSandboxHome();

  test('Pi config and credentials stay read-only even when the agent directory is in a temp directory', async () => {
    const tempAgent = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-tmp-agent-')));
    writeFileSync(join(tempAgent, 'settings.json'), '{}');
    writeFileSync(join(tempAgent, 'auth.json'), '{}');
    const id = newJobId('tmp-agent');
    const argv = sandboxed(
      ['bash', '-c', `echo x > ${tempAgent}/settings.json; echo '{"k":1}' > ${tempAgent}/auth.json`],
      { writable: [work], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir: tempAgent, jobDir: join(jobsIn(), id) },
      process.platform,
      {},
    );
    await settled(launch(jobsIn(), spec('', { id, argv, cwd: work })).spec.id, jobsIn());
    expect(readFileSync(join(tempAgent, 'settings.json'), 'utf8')).toBe('{}');
    expect(readFileSync(join(tempAgent, 'auth.json'), 'utf8').trim()).toBe('{}');
    rmSync(tempAgent, { recursive: true, force: true });
  });

  test('a job cannot plant a git hook in a checkout it may write', async () => {
    await run(`echo evil > ${work}/.git/hooks/pre-commit`);
    expect(existsSync(join(work, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  test('a protected path the job created is removed when it exits', async () => {
    const created = join(work, '.pi', 'extensions');
    const id = newJobId('create');
    const argv = sandboxed(
      ['bash', '-c', `mkdir -p ${created} && echo planted > ${created}/x.ts`],
      { writable: [work], protect: [created], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) },
      process.platform,
      {},
    );
    const done = await settled(launch(jobsIn(), spec('', { id, argv, cwd: work, sweep: { roots: [work], protect: [created] } })).spec.id, jobsIn());
    expect(existsSync(created)).toBe(false);
    if (process.platform === 'linux') expect(tail(outputPath(done.dir), TAIL_LINES)).toContain(`pstack quarantined ${created}`);
  });

  test.runIf(process.platform === 'linux')('the user session bus is hidden even without XDG_RUNTIME_DIR', async () => {
    const runtime = `/run/user/${process.getuid?.() ?? 0}`;
    const id = newJobId('bus');
    const argv = sandboxed(['bash', '-c', `ls -A ${runtime} 2>/dev/null | wc -l`], { writable: [work], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) }, 'linux', {});
    const done = await settled(launch(jobsIn(), spec('', { id, argv, cwd: work })).spec.id, jobsIn());
    expect(tail(outputPath(done.dir), BUS_TAIL_LINES).trim()).toBe('0');
  });

});

describe.runIf(supportsSandbox)('sandbox containment, processes and credentials', { timeout: CONTAINMENT_TIMEOUT_MS }, () => {
  useSandboxHome();

  test.runIf(process.platform === 'linux')('stopping a job ends processes that left its process group', async () => {
    const id = newJobId('escaper');
    const pidFile = join(work, 'escaped.pid');
    const duration = ESCAPER_BASE_SECONDS + (process.pid % ESCAPER_JITTER_SECONDS);
    const argv = sandboxed(
      ['bash', '-c', `setsid sleep ${duration} & sleep 0.2; pgrep -n -x sleep > ${pidFile}; sleep ${duration}`],
      { writable: [work], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) },
      'linux',
      {},
    );
    const job = launch(jobsIn(), spec('', { id, argv, cwd: work }));
    await expect.poll(() => existsSync(pidFile), { timeout: SETTLE_TIMEOUT_MS }).toBe(true);
    await stop(job);
    const survivors = () => execFileSync('bash', ['-c', `pgrep -c -f "^sleep ${duration}$" || true`], { encoding: 'utf8' }).trim();
    await expect.poll(survivors, { timeout: SHORT_POLL_TIMEOUT_MS }).toBe('0');
  });

  test('a job cannot write outside its writable paths when none of them is in the agent directory', async () => {
    const id = newJobId('no-agent-writable');
    const argv = sandboxed(
      ['bash', '-c', `touch ${work}/ok.txt; touch ${home}/outside.txt`],
      { writable: [work], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) },
      process.platform,
      {},
    );
    await settled(launch(jobsIn(), spec('', { id, argv, cwd: work })).spec.id, jobsIn());
    expect([existsSync(join(work, 'ok.txt')), existsSync(join(home, 'outside.txt'))]).toEqual([true, false]);
  });

  test('a job writes its own credentials copy and never the real auth.json', async () => {
    const id = newJobId('creds');
    const credentials = join(jobsIn(), id, 'agent');
    mkdirSync(credentials, { recursive: true });
    writeFileSync(join(credentials, 'auth.json'), '{}');
    writeFileSync(join(agentDir, 'auth.json'), '{}');
    const nested = join(jobsIn(), id, 'nested');
    mkdirSync(nested);
    const command = `echo copy > ${credentials}/auth.json; echo real > ${agentDir}/auth.json; echo other > ${credentials}/settings.json`;
    const argv = sandboxed(['bash', '-c', command], { writable: [work, nested], protect: [], lock: [], gitDirs: [], checkouts: [], credentials, agentDir, jobDir: join(jobsIn(), id) }, process.platform, {});
    await settled(launch(jobsIn(), spec('', { id, argv, cwd: work })).spec.id, jobsIn());
    expect([readFileSync(join(credentials, 'auth.json'), 'utf8').trim(), readFileSync(join(agentDir, 'auth.json'), 'utf8').trim(), existsSync(join(credentials, 'settings.json'))]).toEqual(['copy', '{}', false]);
  });

  test('a job cannot rewrite its own spec', async () => {
    const done = await run(`for f in ${jobsIn()}/*/job.json; do echo '{}' > "$f"; done`);
    expect(done.spec.argv.join(' ')).toMatch(/sandbox-exec|exec bwrap/);
  });
});
