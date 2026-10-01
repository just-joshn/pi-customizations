import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { baseEnv, cleanDirectories, git, installGt, makeDirectory, makeRepo, runCli, stackLog } from './orch-fixtures.ts';

const cli = (store: string, ...args: string[]) => runCli(['--store', store, ...args]);
const ok = (store: string, ...args: string[]) => {
  const result = cli(store, ...args);
  expect({ args, code: result.code, stderr: result.stderr }).toEqual({ args, code: 0, stderr: '' });
  return result.stdout;
};

afterAll(cleanDirectories);

let seeded = '';
let empty = '';
let pushedLines: string[] = [];

async function seed(): Promise<void> {
  seeded = await makeDirectory();
  empty = await makeDirectory();
  ok(empty, 'init');
  ok(seeded, 'init');
  for (const n of [1, 2, 3, 4, 5]) {
    ok(seeded, 'unit', 'add', `u${n}`, '--track', 't');
    ok(seeded, 'gate', 'park', `g${n}`, '--question', `q${n}`, '--options', 'a|b', '--default', 'a');
    ok(seeded, 'standing', 'add', `order ${n}`);
  }
  ok(seeded, 'unit', 'set', 'u1', '--state', 'done', '--pr', '12');
  ok(seeded, 'ledger', 'record', '12', 'abc', 'live-ui-verified', '--evidence', 'e.md');
  pushedLines = [1, 2, 3, 4, 5].map((n) => ok(seeded, 'inbox', 'push', 'agent', `u${n}`, 'done', '--report', `r${n}.md`).trim());
}

beforeAll(seed, 120_000);

describe('orch CLI compact output prints exactly the documented lines', () => {
  test.each([
    { name: 'init prints the absolute store', args: () => ['init'], expected: () => `initialized ${seeded}\n` },
    { name: 'unit get prints the seven-cell TSV row on one line', args: () => ['unit', 'get', 'u1'], expected: () => 'u1\tt\tdone\t\t12\t\t\n' },
    { name: 'unit list prints four rows then the more trailer', args: () => ['unit', 'list'], expected: () => 'u1\tt\tdone\t\t12\t\t\nu2\tt\tpending\t\t\t\t\nu3\tt\tpending\t\t\t\t\nu4\tt\tpending\t\t\t\t\n... 1 more; use --json\n' },
    { name: 'unit counts prints state=n pairs', args: () => ['unit', 'counts'], expected: () => 'done=1, pending=4\n' },
    { name: 'ledger check prints the verdict', args: () => ['ledger', 'check', '12', 'abc'], expected: () => 'live-ui-verified\n' },
    { name: 'ledger summary prints verdict counts', args: () => ['ledger', 'summary'], expected: () => 'live-ui-verified=1\n' },
    { name: 'inbox count prints the count', args: () => ['inbox', 'count'], expected: () => '5\n' },
    { name: 'gate list prints four rows then the more trailer', args: () => ['gate', 'list'], expected: () => 'g1\tq1\ta|b\ta\ng2\tq2\ta|b\ta\ng3\tq3\ta|b\ta\ng4\tq4\ta|b\ta\n... 1 more; use --json\n' },
    { name: 'standing show prints four numbered rows then the more trailer', args: () => ['standing', 'show'], expected: () => '1. order 1\n2. order 2\n3. order 3\n4. order 4\n... 1 more; use --json\n' },
    { name: 'frontier show prints the empty frontier', args: () => ['frontier', 'show'], expected: () => 'generation=0 prs=none lowest-unmerged=none\n' },
  ])('$name', ({ args, expected }) => {
    expect(ok(seeded, ...args())).toBe(expected());
  });

  test.each([
    { name: 'unit list on an empty store', args: ['unit', 'list'], expected: '(no units)\n' },
    { name: 'unit counts on an empty store', args: ['unit', 'counts'], expected: 'none\n' },
    { name: 'inbox drain on an empty inbox', args: ['inbox', 'drain'], expected: '(empty)\n' },
    { name: 'gate list with no open gates', args: ['gate', 'list'], expected: '(no open gates)\n' },
    { name: 'standing show with no orders', args: ['standing', 'show'], expected: '(no standing orders)\n' },
  ])('$name', ({ args, expected }) => {
    expect(ok(empty, ...args)).toBe(expected);
  });
});

describe('orch CLI write commands print one compact line', () => {
  test('unit add, unit set, ledger record, gate park, gate resolve, inbox push, and standing add each print a single line', async () => {
    const store = await makeDirectory();
    ok(store, 'init');
    const lines = [
      ok(store, 'unit', 'add', 'w1', '--track', 'tr'),
      ok(store, 'unit', 'set', 'w1', '--state', 'building', '--branch', 'b', '--sha', 's1'),
      ok(store, 'ledger', 'record', '5', 'deadbeef', 'unit-test-verified', '--evidence', 'ev'),
      ok(store, 'gate', 'park', 'gx', '--question', 'q', '--options', 'o', '--default', 'd'),
      ok(store, 'gate', 'resolve', 'gx', '--answer', 'yes'),
      ok(store, 'standing', 'add', 'never force push'),
    ];
    expect(lines).toEqual(['w1\ttr\tpending\t\t\t\t\n', 'w1\ttr\tbuilding\tb\t\ts1\t\n', '5\tdeadbeef\tunit-test-verified\n', 'gx\topen\n', 'gx\tresolved\tyes\n', '1. never force push\n']);
  });

  test('inbox push prints unit, status, and the pointer filename', () => {
    expect(pushedLines).toHaveLength(5);
    expect(pushedLines[0]).toMatch(/^u1\tdone\t\d{4}-\d\d-\d\dT[\w-]+-\d+-[0-9a-f-]{36}\.tsv$/);
  });

  test('inbox drain prints every pointer with no limit, then the inbox is empty', () => {
    const lines = ok(seeded, 'inbox', 'drain').trimEnd().split('\n');
    expect(lines.map((line) => line.split('\t').slice(1))).toEqual([1, 2, 3, 4, 5].map((n) => ['agent', `u${n}`, 'done', `r${n}.md`]));
    expect(ok(seeded, 'inbox', 'drain')).toBe('(empty)\n');
  });
});

describe('orch CLI status prints three lines', () => {
  test('counts, changed, and gates open lines with the ids list and the more suffix', () => {
    expect(ok(seeded, 'status')).toBe('counts: units=5; states=done=1, pending=4; ledger=live-ui-verified=1\nchanged: first render\ngates open: 5; ids=g1,g2,g3,g4,+1 more\n');
    expect(ok(seeded, 'status')).toBe('counts: units=5; states=done=1, pending=4; ledger=live-ui-verified=1\nchanged: no derived changes\ngates open: 5; ids=g1,g2,g3,g4,+1 more\n');
  });

  test('an empty store prints none and no ids', () => {
    expect(ok(empty, 'status')).toBe('counts: units=0; states=none; ledger=none\nchanged: first render\ngates open: 0\n');
  });
});

describe('orch CLI --json', () => {
  test('is pretty-printed with two-space indentation and a trailing newline', () => {
    const store = seeded;
    ok(store, 'unit', 'add', 'j1', '--track', 'tj', '--json');
    expect(ok(store, 'unit', 'get', 'j1', '--json')).toBe('{\n  "id": "j1",\n  "track": "tj",\n  "state": "pending",\n  "branch": "",\n  "pr": "",\n  "sha": "",\n  "brief": ""\n}\n');
  });
});

describe('orch CLI rejects invalid arguments with exit 1', () => {
  test.each([
    { args: ['unit', 'set', 'u1', '--state', 'done', '--pr', '0'], message: 'must be a positive integer' },
    { args: ['unit', 'set', 'u1', '--state', 'done', '--pr', '01'], message: 'must be a positive integer' },
    { args: ['unit', 'set', 'u1', '--state', 'done', '--pr', '9007199254740993'], message: 'must be a positive integer' },
    { args: ['ledger', 'check', '01', 'abc'], message: 'must be a positive integer' },
    { args: ['ledger', 'check', 'abc', 'abc'], message: 'must be a positive integer' },
    { args: ['frontier', 'set', '--repo', 'r', '--prs', '1,,2'], message: 'requires a comma-separated PR list' },
    { args: ['frontier', 'set', '--repo', 'r', '--prs', '1,0'], message: 'must be a positive integer' },
    { args: ['unit', 'get', 'u1', 'extra'], message: 'too many arguments' },
    { args: ['status', 'extra'], message: 'too many arguments' },
    { args: ['ledger', 'record', '1', 'sha', 'bogus', '--evidence', 'e'], message: 'verdict must be' },
  ])('$args', ({ args, message }) => {
    const result = cli(seeded, ...args);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(message);
  });

  test('a group command without a subcommand requires a store, then fails with a valid-command message and help', () => {
    const result = cli(seeded, 'unit');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('error: a valid command is required');
    expect(result.stderr).toContain('Usage: orch');
  });
});

describe('orch CLI default store', () => {
  const digest = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 8);

  test('derives a durable agent store from the workspace when no store is given', async () => {
    const agent = await makeDirectory();
    const workspace = join(await makeDirectory(), 'my project');
    await Bun.write(join(workspace, '.keep'), '');
    const result = runCli(['init'], { cwd: workspace, env: baseEnv({ PI_CODING_AGENT_DIR: agent }) });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`initialized ${join(agent, 'pstack', 'store', `my-project-${digest(workspace)}`, 'orchestrate', 'my-project')}\n`);
  });

  test('ORCH_STORE beats the default and --store beats ORCH_STORE', async () => {
    const agent = await makeDirectory();
    const fromEnv = await makeDirectory();
    const fromFlag = await makeDirectory();
    const env = baseEnv({ PI_CODING_AGENT_DIR: agent, ORCH_STORE: fromEnv });
    expect(runCli(['init'], { env }).stdout).toBe(`initialized ${fromEnv}\n`);
    expect(runCli(['--store', fromFlag, 'init'], { env }).stdout).toBe(`initialized ${fromFlag}\n`);
  });

  test('bare orch with the default store fails with the valid-command message', async () => {
    const agent = await makeDirectory();
    const result = runCli([], { env: baseEnv({ PI_CODING_AGENT_DIR: agent }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('error: a valid command is required');
  });
});

describe('orch CLI frontier set environment', () => {
  test('uses ORCH_REPO as the repository, runs gt with NO_COLOR=1, and prints the compact frontier line', async () => {
    const directory = await makeDirectory();
    const repo = await makeRepo(directory, ['stack/a']);
    const sha = git(repo, 'rev-parse', 'stack/a');
    const gt = await installGt(directory, repo, { logShort: stackLog('stack/a'), info: { 'stack/a': 'stack/a\nPR #31 (Needs approvals) change' } });
    const store = await makeDirectory();
    ok(store, 'init');
    const env = baseEnv({ ORCH_REPO: repo, ORCH_STORE: store, PATH: `${gt}:${process.env.PATH}` });
    const result = runCli(['frontier', 'set'], { env });
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: '' });
    expect(result.stdout).toBe(`generation=1 prs=stack/a#31@${sha}:OPEN lowest-unmerged=31\n`);
  });

  test('without --repo or ORCH_REPO it fails naming both', async () => {
    const store = await makeDirectory();
    ok(store, 'init');
    const result = runCli(['frontier', 'set'], { env: baseEnv({ ORCH_STORE: store }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('set --repo <dir> or ORCH_REPO');
  });
});
