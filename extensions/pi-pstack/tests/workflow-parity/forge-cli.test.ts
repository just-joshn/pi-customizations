import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

import { afterEach, expect, test } from 'vitest';
import { DEFAULT_IMAGE } from '../../src/container.ts';
import { FORGE_CLI, type ForgeHandle, setupForge } from './fixtures/forge.ts';
import { engineAvailable } from './lib/container-lock.ts';
import type { Ctx } from './lib/driver.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { ctx: Ctx; forge: ForgeHandle } {
  const sandbox = mkdtempSync(join(tmpdir(), 'forge-cli-test-'));
  roots.push(sandbox);
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const base = git('rev-parse', 'HEAD');
  const ctx: Ctx = { driver: 'scripted', sandbox, repo, pkg: '', base, commits: [base], runId: 'test', skill: (name) => name, playbook: (name) => name, agentDir: join(sandbox, 'agent'), sessionsDir: join(sandbox, 'sessions') };
  const forge = setupForge(ctx, {
    owner: 'fixture',
    name: 'repo',
    originCli: true,
    branches: [],
    prs: [
      {
        number: 71,
        title: 'Review',
        head: 'main',
        base: 'main',
        author: 'fixture',
        threads: [{ id: 'thread-1', comments: [{ id: '901', author: 'reviewer', body: 'Finding', path: 'README.md', line: 1, createdAt: '2026-11-13T00:00:00Z' }] }],
      },
    ],
  });
  return { ctx, forge };
}

function call(ctx: Ctx, forge: ForgeHandle, tool: string, ...args: string[]) {
  return spawnSync(join(forge.bin, tool), args, { cwd: ctx.repo, encoding: 'utf8', env: { ...process.env, FORGE_GIT_DIR: forge.bare } });
}

test('run list filters the real head branch and omits unrelated runs', () => {
  const { ctx, forge } = fixture();
  const listed = call(ctx, forge, 'gh', 'run', 'list', '--branch', 'main', '--json', 'databaseId,headBranch,headSha,status,conclusion');
  expect(listed.status, listed.stderr).toBe(0);
  expect(JSON.parse(listed.stdout)).toEqual([{ databaseId: 9071, headBranch: 'main', headSha: ctx.base, status: 'completed', conclusion: 'success' }]);
  const absent = call(ctx, forge, 'gh', 'run', 'list', '-b', 'unrelated', '--json', 'databaseId');
  expect(absent.status, absent.stderr).toBe(0);
  expect(JSON.parse(absent.stdout)).toEqual([]);
});

test('PR JSON fields expose actual commits, changed files and checks', () => {
  const { ctx, forge } = fixture();
  const branch = 'feature';
  execFileSync('git', ['-C', ctx.repo, 'checkout', '-qb', branch]);
  writeFileSync(join(ctx.repo, 'change.txt'), 'new behavior\n');
  execFileSync('git', ['-C', ctx.repo, 'add', 'change.txt']);
  execFileSync('git', ['-C', ctx.repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'add behavior']);
  execFileSync('git', ['-C', ctx.repo, 'push', '-q', 'origin', branch]);
  const path = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.prs['71'].head = branch;
  writeFileSync(path, JSON.stringify(state));
  const result = call(ctx, forge, 'gh', 'pr', 'view', '71', '--json', 'commits,files,statusCheckRollup');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ commits: [{ messageHeadline: 'add behavior', oid: execFileSync('git', ['-C', ctx.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }], files: [{ path: 'change.txt', additions: 1, deletions: 0 }], statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
});

test('freshness events accept upstream verdicts but not prose mentioning PASS', () => {
  const { ctx, forge } = fixture();
  const path = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.events = [{ when: { op: 'comment', verdictsFor: [71] }, do: [] }];
  writeFileSync(path, JSON.stringify(state));
  expect(call(ctx, forge, 'gh', 'pr', 'comment', '71', '--body', 'CI says PASS, not a verdict').status).toBe(0);
  expect(JSON.parse(readFileSync(path, 'utf8')).events[0].done).not.toBe(true);
  expect(call(ctx, forge, 'gh', 'pr', 'comment', '71', '--body', 'PASS+NOTES: ran the user flow.').status).toBe(0);
  expect(JSON.parse(readFileSync(path, 'utf8')).events[0].done).toBe(true);
});

test.skipIf(!engineAvailable())('a container reads every host forge comment in full', async () => {
  const { ctx, forge } = fixture();
  const reader = `const {spawnSync}=require('node:child_process');require('node:readline').createInterface({input:process.stdin}).on('line',()=>{const result=spawnSync('node',[${JSON.stringify(FORGE_CLI)},'gh','pr','view','71','--json','comments'],{encoding:'utf8',env:{...process.env,FORGE_GIT_DIR:'/sandbox/forge/origin.git',PSTACK_CONTAINER:'1'}});console.log(JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr}))});`;
  const child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--name',
      basename(ctx.sandbox),
      '--user',
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      '--mount',
      `type=bind,src=${ctx.sandbox},dst=/sandbox`,
      '--mount',
      `type=bind,src=${FORGE_CLI},dst=${FORGE_CLI},readonly`,
      DEFAULT_IMAGE,
      'node',
      '-e',
      reader,
    ],
    { stdio: 'pipe' },
  );
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const bodies: string[] = [];
  try {
    for (let index = 0; index < 16; index += 1) {
      for (const body of [`short-${index}`, `long-${index}-${'x'.repeat(512)}`]) {
        const posted = call(ctx, forge, 'gh', 'pr', 'comment', '71', '--body', body);
        expect(posted.status, posted.stderr).toBe(0);
        bodies.push(body);
        child.stdin.write('\n');
        const line = await lines.next();
        expect(line.done, stderr).toBe(false);
        const result = JSON.parse(line.value ?? '{}') as { status: number | null; stdout: string; stderr: string };
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout).comments.map((comment: { body: string }) => comment.body)).toEqual(bodies);
      }
    }
  } finally {
    child.stdin.end();
    const [code] = await exited;
    expect(code, stderr).toBe(0);
  }
});

test('a waiter cannot mutate forge state while another process holds the lock beyond eight seconds', async () => {
  const { ctx, forge } = fixture();
  const bin = join(ctx.sandbox, 'slow-git');
  mkdirSync(bin);
  const marker = join(ctx.sandbox, 'holding');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const wrapper = join(bin, 'git');
  writeFileSync(wrapper, `#!/bin/sh\nif mkdir '${marker}' 2>/dev/null; then sleep 11; fi\nexec '${realGit}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  const holder = spawn(join(forge.bin, 'gh'), ['pr', 'comment', '71', '--body', 'holder'], {
    cwd: ctx.repo,
    env: { ...process.env, FORGE_GIT_DIR: forge.bare, PATH: `${bin}:${process.env['PATH']}` },
    stdio: 'ignore',
  });
  const exited = once(holder, 'exit');
  try {
    await expect.poll(() => existsSync(marker)).toBe(true);
    const state = readFileSync(join(forge.dir, 'state.json'), 'utf8');
    const actions = readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8');
    const waiter = call(ctx, forge, 'gh', 'pr', 'comment', '71', '--body', 'waiter');
    expect(waiter.status, waiter.stderr).toBe(1);
    expect(waiter.stderr).toContain('forge: lock acquisition timed out');
    expect(readFileSync(join(forge.dir, 'state.json'), 'utf8')).toBe(state);
    expect(readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8')).toBe(actions);
    expect(existsSync(join(forge.dir, 'lock'))).toBe(true);
  } finally {
    const [code] = await exited;
    expect(code).toBe(0);
  }
  expect(JSON.parse(call(ctx, forge, 'gh', 'pr', 'view', '71', '--json', 'comments').stdout).comments.map((comment: { body: string }) => comment.body)).toEqual(['holder']);
});

test('uncertain abandoned ownership is not reclaimed by competing waiters', async () => {
  const { ctx, forge } = fixture();
  const lock = join(forge.dir, 'lock');
  mkdirSync(lock);
  const ownership = JSON.stringify({ pid: process.pid, namespace: 'another-namespace', start: 'unknown' });
  writeFileSync(join(lock, 'owner.json'), ownership);
  const state = readFileSync(join(forge.dir, 'state.json'), 'utf8');
  const actions = readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8');
  const waiters = ['first', 'second'].map((body) => {
    const child = spawn(join(forge.bin, 'gh'), ['pr', 'comment', '71', '--body', body], { cwd: ctx.repo, env: { ...process.env, FORGE_GIT_DIR: forge.bare } });
    let stderr = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    return once(child, 'exit').then(([code]) => ({ code, stderr }));
  });
  for (const result of await Promise.all(waiters)) {
    expect(result.code, result.stderr).toBe(1);
    expect(result.stderr).toContain('forge: lock acquisition timed out');
  }
  expect(readFileSync(join(lock, 'owner.json'), 'utf8')).toBe(ownership);
  expect(readFileSync(join(forge.dir, 'state.json'), 'utf8')).toBe(state);
  expect(readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8')).toBe(actions);
});

test('help at any command depth leaves forge state and actions unchanged', () => {
  const { ctx, forge } = fixture();
  const state = readFileSync(join(forge.dir, 'state.json'), 'utf8');
  const actions = readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8');
  for (const tool of ['gh', 'origin']) {
    for (const args of [['--help'], ['pr', '-h'], ['pr', 'create', '--help'], ['pr', 'merge', '71', '-h'], ['api', 'repos/fixture/repo/pulls/71/comments/901/replies', '--method', 'POST', '--help']]) {
      const result = call(ctx, forge, tool, ...args);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/usage|help/i);
      expect(readFileSync(join(forge.dir, 'state.json'), 'utf8')).toBe(state);
      expect(readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8')).toBe(actions);
    }
  }
  expect(call(ctx, forge, 'gh', 'pr', 'create', '--title', 'Real PR').status).toBe(0);
  expect(JSON.parse(readFileSync(join(forge.dir, 'state.json'), 'utf8')).prs['72'].title).toBe('Real PR');
});

test.each([
  ['query($number:Int!) { repository(owner:"fixture",name:"repo") { pullRequest(number:$number) { reviewThreads(first:100) { nodes { id isResolved } } } } }', ['-F', 'number=71']],
  ['{ repository(owner:"fixture",name:"repo") { pullRequest(number:71) { reviewThreads(first:100) { nodes { id } } } }', []],
  ['query ReviewThreads($pr:Int!) { repository(owner:"fixture",name:"repo") { pullRequest(number:$pr) { reviewThreads(first:100) { nodes { id } } } }', ['-F', 'pr=71']],
])('review thread queries use their field arguments, not the operation or variable name: %s', (query, fields) => {
  const { ctx, forge } = fixture();
  const result = call(ctx, forge, 'gh', 'api', 'graphql', '-f', `query=${query}`, ...fields);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).data.repository.pullRequest.reviewThreads.nodes[0].id).toBe('thread-1');
  const absent = query.replace('number:71', 'number:999').replace('number:$number', 'number:999').replace('number:$pr', 'number:999');
  expect(call(ctx, forge, 'gh', 'api', 'graphql', '-f', `query=${absent}`, ...fields).status).not.toBe(0);
});

test('generic review-thread reads expose the REST comment identifier', () => {
  const { ctx, forge } = fixture();
  const query = 'query($n:Int!){repository(owner:"fixture",name:"repo"){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:50){nodes{databaseId author{login} body createdAt}}}}}}}';
  const result = call(ctx, forge, 'gh', 'api', 'graphql', '-f', `query=${query}`, '-F', 'n=71');
  expect(result.status, result.stderr).toBe(0);
  const thread = JSON.parse(result.stdout).data.repository.pullRequest.reviewThreads.nodes[0];
  expect(thread).toMatchObject({ isOutdated: false, path: 'README.md', line: 1 });
  expect(String(thread.comments.nodes[0].databaseId)).toBe('901');
});

test.each(['id', 'arbitrary_name'])('resolveReviewThread uses the input argument with variable %s', (name) => {
  const { ctx, forge } = fixture();
  const query = `mutation($${name}:ID!){resolveReviewThread(input:{threadId:$${name}}){thread{id}}}`;
  const missing = call(ctx, forge, 'gh', 'api', 'graphql', '-f', `query=${query}`, '-F', `${name}=absent`);
  expect(missing.status).not.toBe(0);
  const result = call(ctx, forge, 'gh', 'api', 'graphql', '-f', `query=${query}`, '-F', `${name}=thread-1`);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(forge.dir, 'state.json'), 'utf8')).prs['71'].threads[0].resolved).toBe(true);
});

test.each(['--jq', '-q'])('forge applies %s and rejects invalid queries', (flag) => {
  const { ctx, forge } = fixture();
  expect(call(ctx, forge, 'gh', 'pr', 'view', '71', '--json', 'number', flag, '.number').stdout.trim()).toBe('71');
  expect(call(ctx, forge, 'gh', 'pr', 'view', '71', '--json', 'number', flag, '[').status).not.toBe(0);
});

test('forge version and PR diff are read-only supported commands', () => {
  const { ctx, forge } = fixture();
  expect(call(ctx, forge, 'gh', '--version').stdout).toMatch(/^gh version /);
  const git = (...args: string[]) => execFileSync('git', ['-C', ctx.repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git('checkout', '-b', 'feature');
  writeFileSync(join(ctx.repo, 'README.md'), 'changed fixture\n');
  git('add', '.');
  git('commit', '-m', 'change');
  git('push', 'origin', 'feature');
  const statePath = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.prs['71'].head = 'feature';
  writeFileSync(statePath, JSON.stringify(state));
  expect(call(ctx, forge, 'gh', 'pr', 'diff', '71').stdout).toContain('+changed fixture');
  expect(call(ctx, forge, 'gh', 'pr', 'diff', '71', '--name-only').stdout.trim()).toBe('README.md');
  expect(call(ctx, forge, 'gh', 'pr', 'diff', '999').status).not.toBe(0);
});

test('resolveReviewThread accepts an input object variable', () => {
  const { ctx, forge } = fixture();
  const payload = join(ctx.sandbox, 'mutation.json');
  writeFileSync(payload, JSON.stringify({ query: 'mutation($data:ResolveReviewThreadInput!){resolveReviewThread(input:$data){thread{id}}}', variables: { data: { threadId: 'thread-1' } } }));
  expect(call(ctx, forge, 'gh', 'api', 'graphql', '--input', payload).status).toBe(0);
});

test('repository identity reads honor selected JSON fields', () => {
  const { ctx, forge } = fixture();
  const result = call(ctx, forge, 'gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('fixture/repo');
});

test('forge implementation source is not staged in the sandbox', () => {
  const { forge } = fixture();
  expect(existsSync(join(forge.bin, 'forge-cli.mjs'))).toBe(false);
});

test('review comments expose reply ids and REST replies are readable in the same thread', () => {
  const { ctx, forge } = fixture();
  const endpoint = 'repos/fixture/repo/pulls/71/comments';
  const result = call(ctx, forge, 'gh', 'api', endpoint);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([expect.objectContaining({ id: '901', body: 'Finding', user: { login: 'reviewer' }, path: 'README.md', line: 1 })]);
  const payload = join(ctx.sandbox, 'reply.json');
  writeFileSync(payload, JSON.stringify({ body: 'Reply as data $(not a command)' }));
  const reply = call(ctx, forge, 'gh', 'api', `${endpoint}/901/replies`, '--method', 'POST', '--input', payload);
  expect(reply.status, reply.stderr).toBe(0);
  const comments = JSON.parse(call(ctx, forge, 'gh', 'api', endpoint).stdout);
  expect(comments).toHaveLength(2);
  expect(comments[1]).toMatchObject({ id: JSON.parse(reply.stdout).id, in_reply_to_id: '901', body: 'Reply as data $(not a command)' });
  expect(call(ctx, forge, 'gh', 'api', `${endpoint}/missing/replies`, '--method', 'POST', '--input', payload).status).not.toBe(0);
  expect(JSON.parse(call(ctx, forge, 'gh', 'api', endpoint).stdout)).toHaveLength(2);
});
