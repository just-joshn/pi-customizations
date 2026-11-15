import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { claimWake, type JobSpec, launch, list, newJobId, outputPath, read, STOPPED_EXIT_CODE, stop, tail, tmuxSocket } from '../src/jobs.ts';
import { bwrapArgs, SANDBOX_ENV, type SandboxPolicy, sandboxed, seatbeltProfile } from '../src/sandbox.ts';

const owner = `test${process.pid}`;
const socket = tmuxSocket(owner);
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
  await expect.poll(() => read(jobsRoot, id, owner)?.status.state, { timeout: 10_000 }).not.toBe('running');
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

describe('tmux jobs', { timeout: 20_000 }, () => {
  test('without tmux a job is refused with a way to fix it, never run another way', () => {
    const path = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      expect(() => launch(root, spec('true'))).toThrow(/needs tmux/);
    } finally {
      process.env['PATH'] = path;
    }
  });

  test('a finished command keeps its exit code and output', async () => {
    const job = launch(root, spec('echo hello; exit 3'));
    const done = await settled(job.spec.id);
    expect(done.status).toEqual({ state: 'exited', code: 3 });
    expect(tail(outputPath(done.dir), 5)).toContain('hello');
  });

  test('the command sees the sandbox marker so nested jobs do not re-wrap', async () => {
    const job = launch(root, spec(`echo "marker=$${SANDBOX_ENV}"`));
    expect(tail(outputPath((await settled(job.spec.id)).dir), 5)).toContain('marker=1');
  });

  test('the wrapper sweeps with a copy of the sweeper kept in the job directory, since Node will not run types under node_modules', async () => {
    const job = launch(root, spec('true'));
    const script = /'([^']+sweep\.ts)' '[^']*inventory\.json'/.exec(readFileSync(join(job.dir, 'wrapper.sh'), 'utf8'))?.[1];
    expect(script).toBe(join(job.dir, 'sweep.ts'));
    await settled(job.spec.id);
    expect(execFileSync(process.execPath, [script ?? '', join(job.dir, 'inventory.json')], { encoding: 'utf8' })).toBe('');
  });

  test('a job whose tmux server dies still finishes when its sweep fails, instead of hanging on the closed terminal', async () => {
    const job = launch(root, spec('sleep 30'));
    await expect.poll(() => existsSync(join(job.dir, 'wrapper.pid')), { timeout: 5_000 }).toBe(true);
    const wrapper = Number(readFileSync(join(job.dir, 'wrapper.pid'), 'utf8'));
    rmSync(join(job.dir, 'inventory.json'));
    execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' });
    await expect.poll(() => read(root, job.spec.id, owner)?.status, { timeout: 10_000 }).toEqual({ state: 'exited', code: STOPPED_EXIT_CODE });
    const alive = (): boolean => {
      try {
        process.kill(wrapper, 0);
        return true;
      } catch {
        return false;
      }
    };
    await expect.poll(alive, { timeout: 5_000 }).toBe(false);
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
    const args = bwrapArgs({ ...policy, writable: [tmpdir()], protect: [], agentDir }, { XDG_RUNTIME_DIR: hidden }, 501);
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args).toEqual(expect.arrayContaining(['--unshare-pid', '--tmpfs', hidden]));
    expect(args.filter((arg, i) => arg === agentDir && args[i - 2] !== '--ro-bind' && args[i - 1] !== '--ro-bind')).toEqual([]);
    rmSync(agentDir, { recursive: true });
    rmSync(hidden, { recursive: true });
  });
});

// Each test below reproduces an escape found in review: a sandboxed job reaching an unsandboxed process or file.
// The assertions read host state, since on Linux a write into Pi's agent directory succeeds inside a throwaway overlay.
describe.runIf(process.platform === 'darwin' || process.platform === 'linux')('sandbox containment', { timeout: 20_000 }, () => {
  let home: string;
  let agentDir: string;
  let work: string;

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

  const jobsIn = () => join(agentDir, 'pstack-v2', 'jobs');
  const run = async (command: string, id = newJobId('probe')) => {
    const nested = join(jobsIn(), id, 'nested');
    mkdirSync(nested, { recursive: true });
    const argv = sandboxed(['bash', '-c', command], { writable: [work, nested], protect: [join(work, '.git', 'hooks')], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) }, process.platform, {});
    return settled(launch(jobsIn(), spec('', { id, argv, cwd: work })).spec.id, jobsIn());
  };

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
    if (process.platform === 'linux') expect(tail(outputPath(done.dir), 5)).toContain(`pstack quarantined ${created}`);
  });

  test.runIf(process.platform === 'linux')('the user session bus is hidden even without XDG_RUNTIME_DIR', async () => {
    const runtime = `/run/user/${process.getuid?.() ?? 0}`;
    const id = newJobId('bus');
    const argv = sandboxed(['bash', '-c', `ls -A ${runtime} 2>/dev/null | wc -l`], { writable: [work], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) }, 'linux', {});
    const done = await settled(launch(jobsIn(), spec('', { id, argv, cwd: work })).spec.id, jobsIn());
    expect(tail(outputPath(done.dir), 3).trim()).toBe('0');
  });

  test.runIf(process.platform === 'linux')('stopping a job ends processes that left its process group', async () => {
    const id = newJobId('escaper');
    const pidFile = join(work, 'escaped.pid');
    const duration = 40_000 + (process.pid % 10_000);
    const argv = sandboxed(
      ['bash', '-c', `setsid sleep ${duration} & sleep 0.2; pgrep -n -x sleep > ${pidFile}; sleep ${duration}`],
      { writable: [work], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir, jobDir: join(jobsIn(), id) },
      'linux',
      {},
    );
    const job = launch(jobsIn(), spec('', { id, argv, cwd: work }));
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true);
    await stop(job);
    const survivors = () => execFileSync('bash', ['-c', `pgrep -c -f "^sleep ${duration}$" || true`], { encoding: 'utf8' }).trim();
    await expect.poll(survivors, { timeout: 5_000 }).toBe('0');
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
