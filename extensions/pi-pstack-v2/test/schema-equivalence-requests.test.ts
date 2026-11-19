import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { gitPath, protectedPaths } from '../src/git.ts';
import { exitPath, type Job, type JobSpec, launchBrokered, resultsDir } from '../src/jobs.ts';
import { serveRequests } from '../src/requests.ts';
import { sandboxed } from '../src/sandbox.ts';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('../src/git.ts', () => ({ addWorktree: vi.fn(), dropWorktree: vi.fn(), gitPath: vi.fn(), protectedPaths: vi.fn() }));
vi.mock('../src/sandbox.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/sandbox.ts')>()), sandboxed: vi.fn() }));
vi.mock('../src/jobs.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/jobs.ts')>()), launchBrokered: vi.fn() }));

const EXIT_REFUSED = 126;
const AGENT_DIR = '/agent';
const CREDENTIALS = '/credentials';
const JOB_DIR = '/job';
const SOME_PATH = '/granted';
const NO_LISTS = { protect: [], lock: [], gitDirs: [] };

let work: string;
let repo: string;
let top: Job;
let nested: string;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-equivalence-requests-')));
  repo = join(work, 'repo');
  nested = join(work, 'top', 'nested');
  mkdirSync(repo);
  mkdirSync(nested, { recursive: true });
  const spec = { cwd: repo, brokered: false, policy: { writable: [repo], ...NO_LISTS } } as unknown as JobSpec;
  top = { spec, dir: join(work, 'top'), status: { state: 'running' } };
  vi.mocked(launchBrokered).mockReturnValue(true);
  vi.mocked(sandboxed).mockReturnValue(['sandbox-exec', 'x']);
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
  vi.mocked(gitPath).mockReturnValue(undefined);
  vi.mocked(protectedPaths).mockReturnValue(NO_LISTS);
});

afterEach(() => {
  vi.resetAllMocks();
  rmSync(work, { recursive: true, force: true });
});

const writeRaw = (parent: string, name: string, body: unknown): string => {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), JSON.stringify(body));
  return dir;
};
const outFor = (dir: string): string => resultsDir(top.dir, dir);
const serve = (): void => serveRequests(top, 'sock', nested, false);
const request = (over: Record<string, unknown> = {}) => ({ kind: 'command', cwd: repo, command: ['echo'], brokered: true, policy: { writable: [repo], ...NO_LISTS }, ...over });
/** Every key a current version writes, so a test about something else is not about a missing key. */
const complete = (over: Record<string, unknown> = {}) =>
  request({
    id: 'req',
    name: 'req',
    argv: [],
    out: '',
    owner: 'owner',
    wake: null,
    repeat: false,
    series: 'req',
    socket: '',
    sweep: { roots: [], protect: [] },
    createdAt: '2026-01-01T00:00:00Z',
    policy: { writable: [repo], ...NO_LISTS, checkouts: [], agentDir: AGENT_DIR, credentials: CREDENTIALS, jobDir: JOB_DIR },
    ...over,
  });

describe('a request a worker wrote', () => {
  test('is launched with every key it had, in its order, and none added or stripped', () => {
    const body = { zeta: 1, ...request({ future: { nested: [null] }, wake: null }), omega: 'last' };
    writeRaw(nested, 'req', body);
    serve();
    const launched = vi.mocked(launchBrokered).mock.calls[0]?.[2];
    expect(launched).toStrictEqual(body);
    expect(Object.keys(launched ?? {})).toEqual(Object.keys(body));
  });

  test('is launched without the keys an older version left out of its policy and spec', () => {
    writeRaw(nested, 'req', { kind: 'command', cwd: repo, command: ['echo'], brokered: true, policy: { writable: [repo], protect: [], lock: [], gitDirs: [] } });
    serve();
    expect(launchBrokered).toHaveBeenCalledTimes(1);
  });

  test('is skipped without a brokered flag, and not launched', () => {
    const dir = writeRaw(nested, 'req', request({ brokered: undefined }));
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
    expect(existsSync(exitPath(outFor(dir)))).toBe(false);
  });

  test.each([
    ['no policy', { policy: undefined }],
    ['a policy that is not an object', { policy: 'x' }],
    ['a policy list holding a number', { policy: { writable: [SOME_PATH, 1], ...NO_LISTS } }],
    ['a policy without a lock list', { policy: { writable: [repo], protect: [], gitDirs: [] } }],
    ['a command holding a number', { command: ['echo', 1] }],
    ['a cwd that is not a string', { cwd: 1 }],
  ])('is skipped with %s', (_label, over) => {
    const dir = writeRaw(nested, 'req', request(over));
    serve();
    expect(launchBrokered).not.toHaveBeenCalled();
    expect(existsSync(exitPath(outFor(dir)))).toBe(false);
  });
});

describe('the grant a nested request is held to', () => {
  const nestedChild = (grant: string): string => {
    const parent = writeRaw(nested, 'parent', complete({ brokered: false }));
    mkdirSync(outFor(parent), { recursive: true });
    writeFileSync(join(outFor(parent), 'granted.json'), grant);
    return writeRaw(join(parent, 'nested'), 'child', complete());
  };

  test('is the list of strings in granted.json', () => {
    nestedChild(JSON.stringify([repo]));
    serve();
    expect(launchBrokered).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a list holding a number', JSON.stringify([SOME_PATH, 1])],
    ['a list holding null', JSON.stringify([SOME_PATH, null])],
    ['an object', JSON.stringify({ 0: SOME_PATH, length: 1 })],
    ['a string', JSON.stringify(SOME_PATH)],
  ])('is nothing for %s', (_label, grant) => {
    const child = nestedChild(grant);
    serve();
    expect(Number(readFileSync(exitPath(outFor(child)), 'utf8').trim())).toBe(EXIT_REFUSED);
    expect(launchBrokered).not.toHaveBeenCalled();
  });
});
