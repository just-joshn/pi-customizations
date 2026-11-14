import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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

function topicFixture() {
  const { ctx, forge } = fixture();
  const git = (...args: string[]) => execFileSync('git', ['-C', ctx.repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('checkout', '-qb', 'topic');
  writeFileSync(join(ctx.repo, 'topic.txt'), 'first\n');
  git('add', '.');
  git('commit', '-qm', 'first topic commit');
  const first = git('rev-parse', 'HEAD');
  writeFileSync(join(ctx.repo, 'topic.txt'), 'second\n');
  git('commit', '-qam', 'second topic commit');
  const head = git('rev-parse', 'HEAD');
  git('push', '-q', 'origin', 'topic');
  git('checkout', '-q', 'main');
  writeFileSync(join(ctx.repo, 'trunk.txt'), 'trunk\n');
  git('add', '.');
  git('commit', '-qm', 'trunk commit');
  const base = git('rev-parse', 'HEAD');
  git('push', '-q', 'origin', 'main');
  const path = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.prs['71'].head = 'topic';
  writeFileSync(path, JSON.stringify(state));
  return { ctx, forge, git, first, head, base };
}

test('PR view accepts an explicit branch rather than silently using the current branch', () => {
  const { ctx, forge } = fixture();
  execFileSync('git', ['-C', ctx.repo, 'checkout', '-qb', 'unrelated']);
  const result = call(ctx, forge, 'gh', 'pr', 'view', 'main', '--json', 'number,author');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ number: 71, author: { login: 'fixture' } });
  expect(call(ctx, forge, 'gh', 'pr', 'view', 'missing', '--json', 'number').status).toBe(1);
});

test('PR list honors state and selected JSON fields', () => {
  const { ctx, forge } = fixture();
  const path = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.prs['71'].state = 'MERGED';
  writeFileSync(path, JSON.stringify(state));
  const result = call(ctx, forge, 'gh', 'pr', 'list', '--state', 'merged', '--json', 'number,title,state');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([{ number: 71, title: 'Review', state: 'MERGED' }]);
  expect(JSON.parse(call(ctx, forge, 'gh', 'pr', 'list', '--state', 'open', '--json', 'number').stdout)).toEqual([]);
});

test('PR edit persists title and body from inline, file, and stdin flags', () => {
  const { ctx, forge } = fixture();
  expect(call(ctx, forge, 'gh', 'pr', 'edit', '71', '--title', 'Updated', '--body', 'Inline').status).toBe(0);
  const view = () => JSON.parse(call(ctx, forge, 'gh', 'pr', 'view', '71', '--json', 'title,body').stdout);
  expect(view()).toEqual({ title: 'Updated', body: 'Inline' });
  const file = join(ctx.sandbox, 'body.txt');
  writeFileSync(file, 'File body\n');
  expect(call(ctx, forge, 'gh', 'pr', 'edit', '71', '-F', file).status).toBe(0);
  expect(view().body).toBe('File body\n');
  const stdin = spawnSync(join(forge.bin, 'gh'), ['pr', 'edit', '71', '--body-file', '-', '-t', 'Stdin'], { cwd: ctx.repo, encoding: 'utf8', input: 'Stdin body\n', env: { ...process.env, FORGE_GIT_DIR: forge.bare } });
  expect(stdin.status, stdin.stderr).toBe(0);
  expect(view()).toEqual({ title: 'Stdin', body: 'Stdin body\n' });
  expect(readFileSync(join(forge.dir, 'actions.jsonl'), 'utf8')).toContain('"kind":"edit"');
});

test.each([['--unknown', 'value'], ['--title'], ['--body', 'one', '--body-file', '-']])('PR edit rejects unsupported or invalid flags %j', (...flags) => {
  const { ctx, forge } = fixture();
  const result = call(ctx, forge, 'gh', 'pr', 'edit', '71', ...flags);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/unknown|requires|mutually exclusive/);
  expect(JSON.parse(call(ctx, forge, 'gh', 'pr', 'view', '71', '--json', 'title,body').stdout)).toEqual({ title: 'Review', body: '' });
});

test('PR comments expose author objects without changing recorded actor identity', () => {
  const { ctx, forge } = fixture();
  expect(call(ctx, forge, 'gh', 'pr', 'comment', '71', '--body', 'PASS').status).toBe(0);
  const result = call(ctx, forge, 'gh', 'pr', 'view', '71', '--json', 'comments');
  expect(JSON.parse(result.stdout).comments[0]).toMatchObject({ body: 'PASS', author: { login: 'operator' } });
});

test('workflow JSON exposes run attempts and logs remain separately readable', () => {
  const { ctx, forge } = fixture();
  const result = call(ctx, forge, 'gh', 'run', 'view', '9071', '--json', 'databaseId,attempt,headBranch,status,conclusion');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ databaseId: 9071, attempt: 1, headBranch: 'main', status: 'completed', conclusion: 'success' });
  expect(call(ctx, forge, 'gh', 'run', 'rerun', '9071').status).toBe(0);
  expect(JSON.parse(call(ctx, forge, 'gh', 'run', 'list', '--json', 'attempt').stdout)).toEqual([{ attempt: 2 }]);
  expect(call(ctx, forge, 'gh', 'run', 'view', '99999', '--json', 'attempt').status).toBe(1);
});

test('repository configuration and empty action secrets have API-shaped responses', () => {
  const { ctx, forge } = fixture();
  const repo = call(ctx, forge, 'gh', 'repo', 'view', '--json', 'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed');
  expect(JSON.parse(repo.stdout)).toEqual({ squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true });
  const api = call(ctx, forge, 'gh', 'api', 'repos/fixture/repo');
  expect(api.status, api.stderr).toBe(0);
  expect(JSON.parse(api.stdout)).toMatchObject({ full_name: 'fixture/repo', allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true });
  const secrets = call(ctx, forge, 'gh', 'api', 'repos/fixture/repo/actions/secrets');
  expect(secrets.status, secrets.stderr).toBe(0);
  expect(JSON.parse(secrets.stdout)).toEqual({ total_count: 0, secrets: [] });
  expect(call(ctx, forge, 'gh', 'api', 'repos/fixture/repo/unknown').status).toBe(1);
});

test('compare API reports git ancestry, commits, and changed filenames', () => {
  const { ctx, forge } = fixture();
  const git = (...args: string[]) => execFileSync('git', ['-C', ctx.repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('checkout', '-qb', 'topic');
  writeFileSync(join(ctx.repo, 'topic.txt'), 'topic\n');
  git('add', '.');
  git('commit', '-qm', 'topic');
  const head = git('rev-parse', 'HEAD');
  git('push', '-q', 'origin', 'topic');
  const compare = (base: string, headRef: string) => {
    const result = call(ctx, forge, 'gh', 'api', `repos/fixture/repo/compare/${base}...${headRef}`);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };
  expect(compare('main', 'topic')).toMatchObject({ status: 'ahead', ahead_by: 1, behind_by: 0, commits: [{ sha: head }], files: [{ filename: 'topic.txt' }] });
  expect(compare('topic', 'main')).toMatchObject({ status: 'behind', ahead_by: 0, behind_by: 1, commits: [], files: [] });
  expect(compare(head, head)).toMatchObject({ status: 'identical', ahead_by: 0, behind_by: 0, commits: [], files: [] });
  git('checkout', '-qb', 'other', ctx.base);
  writeFileSync(join(ctx.repo, 'other.txt'), 'other\n');
  git('add', '.');
  git('commit', '-qm', 'other');
  git('push', '-q', 'origin', 'other');
  expect(compare('other', 'topic')).toMatchObject({ status: 'diverged', ahead_by: 1, behind_by: 1, commits: [{ sha: head }], files: [{ filename: 'topic.txt' }] });
  expect(call(ctx, forge, 'gh', 'api', 'repos/fixture/repo/compare/missing...topic').status).not.toBe(0);
});

test('review comment database IDs are numeric and address the same comment through REST', () => {
  const { ctx, forge } = fixture();
  const path = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.prs['71'].threads[0].comments[0].id = 'c-501';
  writeFileSync(path, JSON.stringify(state));
  const query = 'query { repository(owner:"fixture",name:"repo") { pullRequest(number:71) { reviewThreads(first:100) { nodes { comments(first:100) { nodes { databaseId } } } } } } }';
  const result = call(ctx, forge, 'gh', 'api', 'graphql', '-f', `query=${query}`);
  const id = JSON.parse(result.stdout).data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].databaseId;
  expect(typeof id).toBe('number');
  const comments = call(ctx, forge, 'gh', 'api', 'repos/fixture/repo/pulls/71/comments');
  expect(JSON.parse(comments.stdout)[0].id).toBe(id);
  const payload = join(ctx.sandbox, 'reply.json');
  writeFileSync(payload, JSON.stringify({ body: 'Reproduced and fixed.' }));
  const reply = call(ctx, forge, 'gh', 'api', `repos/fixture/repo/pulls/71/comments/${id}/replies`, '--method', 'POST', '--input', payload);
  expect(reply.status, reply.stderr).toBe(0);
  const updated = JSON.parse(call(ctx, forge, 'gh', 'api', 'repos/fixture/repo/pulls/71/comments').stdout);
  expect(updated[1]).toMatchObject({ in_reply_to_id: id, body: 'Reproduced and fixed.' });
});

test('review IDs survive replies to earlier threads and still route to the original thread', () => {
  const { ctx, forge } = fixture();
  const path = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.prs['71'].threads[0].comments[0].id = 'first';
  delete state.prs['71'].threads[0].comments[0].databaseId;
  state.prs['71'].threads.push({ id: 'thread-2', resolved: false, comments: [{ ...state.prs['71'].threads[0].comments[0], id: 'second' }] });
  writeFileSync(path, JSON.stringify(state));
  const list = () => JSON.parse(call(ctx, forge, 'gh', 'api', 'repos/fixture/repo/pulls/71/comments').stdout);
  const before = list();
  const payload = join(ctx.sandbox, 'reply.json');
  writeFileSync(payload, JSON.stringify({ body: 'reply' }));
  const reply = (id: number) => call(ctx, forge, 'gh', 'api', `repos/fixture/repo/pulls/71/comments/${id}/replies`, '-X', 'POST', '--input', payload);
  expect(reply(before[0].id).status).toBe(0);
  expect(list().find((entry: { body: string; id: number }) => entry.body === 'Finding' && entry.id === before[1].id)).toBeDefined();
  expect(
    list()
      .filter((entry: { body: string }) => entry.body === 'Finding')
      .map((entry: { id: number }) => entry.id),
  ).toEqual(before.map((entry: { id: number }) => entry.id));
  expect(reply(before[1].id).status).toBe(0);
  const updated = JSON.parse(readFileSync(path, 'utf8'));
  expect(updated.prs['71'].threads.map((thread: { comments: unknown[] }) => thread.comments.length)).toEqual([2, 2]);
  expect(new Set(list().map((entry: { id: number }) => entry.id)).size).toBe(4);
  expect(updated.prs['71'].threads[1].comments[0].databaseId).toBe(before[1].id);
});

test('the identity jq expression works without an external jq executable', () => {
  const { ctx, forge } = fixture();
  const bin = join(ctx.sandbox, 'no-jq');
  mkdirSync(bin);
  writeFileSync(join(bin, 'jq'), '#!/bin/sh\nexit 99\n');
  chmodSync(join(bin, 'jq'), 0o755);
  const result = spawnSync(process.execPath, [FORGE_CLI, 'gh', 'repo', 'view', '--json', 'name', '-q', '.'], { cwd: ctx.repo, encoding: 'utf8', env: { ...process.env, FORGE_GIT_DIR: forge.bare, PATH: `${bin}:${process.env['PATH']}` } });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ name: 'repo' });
});

// https://cli.github.com/manual/gh_help_formatting specifies embedded jq, including filters and new structures.
test.each(['absent', 'poisoned'])('jq queries use real offline semantics when the external executable is %s', (executable) => {
  const { ctx, forge } = fixture();
  const bin = join(ctx.sandbox, 'query-path');
  mkdirSync(bin);
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  const marker = join(ctx.sandbox, 'external-jq-called');
  if (executable === 'poisoned') {
    writeFileSync(join(bin, 'jq'), `#!/bin/sh\nprintf called > '${marker}'\nexit 99\n`);
    chmodSync(join(bin, 'jq'), 0o755);
  } else {
    expect(spawnSync('jq', ['--version'], { env: { PATH: bin } }).error).toMatchObject({ code: 'ENOENT' });
  }
  const isolated = join(ctx.sandbox, 'isolated-cli');
  mkdirSync(isolated);
  const cli = join(isolated, 'forge-cli.mjs');
  copyFileSync(FORGE_CLI, cli);
  copyFileSync(join(dirname(FORGE_CLI), 'review-ids.ts'), join(isolated, 'review-ids.ts'));
  const dependency = spawnSync(process.execPath, ['--input-type=module', '-e', 'import("jq-web")'], { cwd: isolated, encoding: 'utf8' });
  expect(dependency.status).not.toBe(0);
  expect(dependency.stderr).toContain('ERR_MODULE_NOT_FOUND');
  const query = (...args: string[]) => spawnSync(process.execPath, [cli, 'gh', ...args], { cwd: ctx.repo, encoding: 'utf8', env: { ...process.env, FORGE_GIT_DIR: forge.bare, PATH: bin } });
  const filtered = query('pr', 'list', '--json', 'number,title,author', '--jq', 'map(select(.number > 70)) | map({id: .number, login: .author.login, label: (.title | ascii_upcase)})');
  expect(filtered.status, filtered.stderr).toBe(0);
  expect(JSON.parse(filtered.stdout)).toEqual([{ id: 71, login: 'fixture', label: 'REVIEW' }]);
  const stream = query('repo', 'view', '--json', 'name,owner', '-q', '.name, .owner.login, ([2,3,5] | reduce .[] as $n (0; . + $n))');
  expect(stream.status, stream.stderr).toBe(0);
  expect(stream.stdout).toBe('repo\nfixture\n10\n');
  const empty = query('pr', 'list', '--json', 'number', '-q', '.[] | select(.number < 0)');
  expect(empty.status, empty.stderr).toBe(0);
  expect(empty.stdout).toBe('');
  for (const expression of ['map(', 'error("query runtime failure")']) {
    const invalid = query('repo', 'view', '--json', 'name', '--jq', expression);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toMatch(/jq|compile|runtime failure/i);
    expect(invalid.stdout).toBe('');
  }
  expect(existsSync(marker)).toBe(false);
});

// https://cli.github.com/manual/gh_api documents endpoint placeholder substitution.
test('repository API substitutes owner and repo placeholders', () => {
  const { ctx, forge } = fixture();
  const result = call(ctx, forge, 'gh', 'api', 'repos/{owner}/{repo}');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ full_name: 'fixture/repo', default_branch: 'main' });
  expect(call(ctx, forge, 'gh', 'api', 'repos/other/repo').status).not.toBe(0);
});

// https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference associates each run with head_sha.
test('commit check runs report pending and settled conclusions only for the requested SHA', () => {
  const { ctx, forge, git, first, head } = topicFixture();
  const path = join(forge.dir, 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.prs['71'].ci.waves = [[{ name: 'old build', runId: 801, state: 'SUCCESS' }], [{ name: 'new build', runId: 802, state: 'PENDING', pendingReads: 1 }]];
  state.prs['72'] = { ...state.prs['71'], number: 72, head: 'main', ci: { ...state.prs['71'].ci, waves: [[{ name: 'unrelated build', runId: 803, state: 'FAILURE' }]] } };
  git('push', '-q', '--force', 'origin', `${first}:refs/heads/topic`);
  writeFileSync(path, JSON.stringify(state));
  const runs = (ref: string) => {
    const result = call(ctx, forge, 'gh', 'api', `repos/{owner}/{repo}/commits/${ref}/check-runs`);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };
  expect(runs(first)).toMatchObject({ total_count: 1, check_runs: [{ id: 801, name: 'old build', head_sha: first, status: 'completed', conclusion: 'success' }] });
  git('push', '-q', '--force', 'origin', `${head}:refs/heads/topic`);
  expect(runs(head)).toMatchObject({ total_count: 1, check_runs: [{ id: 802, name: 'new build', head_sha: head, status: 'in_progress', conclusion: null, details_url: 'https://github.com/fixture/repo/actions/runs/802' }] });
  expect(runs('topic')).toMatchObject({ total_count: 1, check_runs: [{ id: 802, head_sha: head, status: 'completed', conclusion: 'success' }] });
  expect(runs(first)).toMatchObject({ total_count: 1, check_runs: [{ id: 801, head_sha: first, conclusion: 'success' }] });
  expect(runs(ctx.base)).toEqual({ total_count: 0, check_runs: [] });
  for (const target of [`repos/fixture/repo/commits/missing/check-runs`, `repos/other/repo/commits/${head}/check-runs`]) {
    const invalid = call(ctx, forge, 'gh', 'api', target);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toMatch(/404|422|not found|unknown/i);
    expect(invalid.stdout).toBe('');
  }
  expect(call(ctx, forge, 'gh', 'api', `repos/fixture/repo/commits/${head}/check-runs`, '-X', 'POST').status).not.toBe(0);
});

test.each(['SUCCESS', 'FAILURE', 'PENDING'])('commit check runs expose REST status and conclusion for %s', (state) => {
  const { ctx, forge } = fixture();
  const path = join(forge.dir, 'state.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.prs['71'].ci.waves = [[{ name: 'build', runId: 9071, state }]];
  writeFileSync(path, JSON.stringify(stored));
  const result = call(ctx, forge, 'gh', 'api', `repos/fixture/repo/commits/${ctx.base}/check-runs`);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ total_count: 1, check_runs: [{ id: 9071, head_sha: ctx.base, status: state === 'PENDING' ? 'in_progress' : 'completed', conclusion: state === 'PENDING' ? null : state.toLowerCase() }] });
});

// https://cli.github.com/manual/gh_pr_merge defines the merge, squash, and rebase strategies.
test.each(['--merge', '-m', '--squash', '-s', '--rebase', '-r'])('PR merge %s preserves the strategy in real git ancestry', (strategy) => {
  const { ctx, forge, base, head } = topicFixture();
  const path = join(forge.dir, 'state.json');
  const inode = statSync(path).ino;
  const result = call(ctx, forge, 'gh', 'pr', 'merge', '71', strategy, '--match-head-commit', head);
  expect(result.status, result.stderr).toBe(0);
  const merged = forge.tip('main');
  const git = (...args: string[]) => execFileSync('git', ['--git-dir', forge.bare, ...args], { encoding: 'utf8' }).trim();
  const parents = git('show', '-s', '--format=%P', merged).split(' ');
  if (strategy === '--merge' || strategy === '-m') {
    expect(parents).toEqual([base, head]);
  } else if (strategy === '--squash' || strategy === '-s') {
    expect(parents).toEqual([base]);
    expect(git('rev-list', '--count', `${base}..${merged}`)).toBe('1');
  } else {
    expect(parents).toHaveLength(1);
    expect(git('rev-list', '--count', `${base}..${merged}`)).toBe('2');
    expect(git('log', '--reverse', '--format=%s', `${base}..${merged}`)).toBe('first topic commit\nsecond topic commit');
    expect(merged).not.toBe(head);
    expect(git('rev-parse', `${merged}~2`)).toBe(base);
  }
  expect(git('show', `${merged}:topic.txt`)).toBe('second');
  expect(git('show', `${merged}:trunk.txt`)).toBe('trunk');
  expect(forge.tip('topic')).toBe(head);
  expect(JSON.parse(readFileSync(path, 'utf8')).prs['71']).toMatchObject({ state: 'MERGED', mergedHead: head });
  expect(statSync(path).ino).toBe(inode);
});

test.each([{ flags: ['--merge', '--squash'] }, { flags: ['--merge', '--rebase'] }, { flags: ['--octopus'] }, { flags: ['--merge', '--delete-branch'] }, { flags: [] }])(
  'PR merge rejects unsupported or ambiguous modes $flags without changing refs or state',
  ({ flags }) => {
    const { ctx, forge, base } = topicFixture();
    const result = call(ctx, forge, 'gh', 'pr', 'merge', '71', ...flags);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsupported|strategy|only one|unknown/i);
    expect(forge.tip('main')).toBe(base);
    expect(JSON.parse(readFileSync(join(forge.dir, 'state.json'), 'utf8')).prs['71'].state).toBe('OPEN');
  },
);

test.each(['--merge', '--squash', '--rebase'])('PR merge %s rejects real conflicts without changing the base or marking the PR merged', (strategy) => {
  const { ctx, forge, git } = topicFixture();
  writeFileSync(join(ctx.repo, 'topic.txt'), 'conflicting trunk content\n');
  git('add', '.');
  git('commit', '-qm', 'conflict with topic');
  const base = git('rev-parse', 'HEAD');
  git('push', '-q', 'origin', 'main');
  const result = call(ctx, forge, 'gh', 'pr', 'merge', '71', strategy);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/conflict|cannot be rebased/i);
  expect(forge.tip('main')).toBe(base);
  expect(JSON.parse(readFileSync(join(forge.dir, 'state.json'), 'utf8')).prs['71'].state).toBe('OPEN');
  expect(existsSync(join(forge.dir, 'lock'))).toBe(false);
});

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
  expect(JSON.parse(result.stdout)).toMatchObject({
    commits: [{ messageHeadline: 'add behavior', oid: execFileSync('git', ['-C', ctx.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }],
    files: [{ path: 'change.txt', additions: 1, deletions: 0 }],
    statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  });
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

test.skipIf(process.env['PSTACK_NON_CONTAINER_TESTS'] === '1' || !engineAvailable())('a container reads every host forge comment in full', async () => {
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
      '--mount',
      `type=bind,src=${join(dirname(FORGE_CLI), 'review-ids.ts')},dst=${join(dirname(FORGE_CLI), 'review-ids.ts')},readonly`,
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
  expect(JSON.parse(result.stdout)).toEqual([expect.objectContaining({ id: 901, body: 'Finding', user: { login: 'reviewer' }, path: 'README.md', line: 1 })]);
  const payload = join(ctx.sandbox, 'reply.json');
  writeFileSync(payload, JSON.stringify({ body: 'Reply as data $(not a command)' }));
  const reply = call(ctx, forge, 'gh', 'api', `${endpoint}/901/replies`, '--method', 'POST', '--input', payload);
  expect(reply.status, reply.stderr).toBe(0);
  const comments = JSON.parse(call(ctx, forge, 'gh', 'api', endpoint).stdout);
  expect(comments).toHaveLength(2);
  expect(comments[1]).toMatchObject({ id: JSON.parse(reply.stdout).id, in_reply_to_id: 901, body: 'Reply as data $(not a command)' });
  expect(call(ctx, forge, 'gh', 'api', `${endpoint}/missing/replies`, '--method', 'POST', '--input', payload).status).not.toBe(0);
  expect(JSON.parse(call(ctx, forge, 'gh', 'api', endpoint).stdout)).toHaveLength(2);
});
