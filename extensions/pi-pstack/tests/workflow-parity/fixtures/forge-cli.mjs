#!/usr/bin/env node
// A stateful fake forge CLI. `node forge-cli.mjs gh <args>` answers like `gh`, `node forge-cli.mjs origin <args>` like the
// Origin CLI. Every PR, check, review thread, comment, merge-queue and merge fact lives in <origin.git>/forge/state.json,
// and every call plus every ref update (the bare repository's pre-receive hook) is appended to actions.jsonl in the same
// directory. The bare repository is the one place a container worker and the host both reach, so both write there.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [tool, ...argv] = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`Usage: ${tool} <command> [flags]\nUse --help for command help.\n`);
  process.exit(0);
}
if (tool === 'gh' && argv.includes('--version')) {
  process.stdout.write('gh version 2.0.0 (pstack fixture)\n');
  process.exit(0);
}
const sh = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...options });

function bareDir() {
  if (process.env.FORGE_GIT_DIR) return process.env.FORGE_GIT_DIR;
  const url = sh('git', ['config', '--get', 'remote.origin.url']).stdout.trim();
  if (url === '') die(1, 'forge: no FORGE_GIT_DIR and no origin remote here');
  return url.replace(/^file:\/\//, '');
}
const BARE = bareDir();
const DIR = join(BARE, 'forge');
const git = (...args) => sh('git', ['--git-dir', BARE, ...args]);
const ACTOR = process.env.FORGE_ACTOR ?? '';
const WHO = { worker: process.env.PSTACK_WORKER_ID ?? '', run: process.env.PSTACK_RUN_ID ?? '', container: process.env.PSTACK_CONTAINER === '1', authenticated: process.env.PSTACK_FAKE_FORGE_CAPABILITY === '1', actor: ACTOR };

function die(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}
const out = (value) => {
  const query = tool === 'gh' ? argv.findIndex((arg) => arg === '--jq' || arg === '-q') : -1;
  if (query !== -1) {
    const result = sh('jq', ['-r', argv[query + 1]], { input: JSON.stringify(value) });
    if (result.status !== 0) die(1, result.stderr || 'gh: jq failed');
    process.stdout.write(result.stdout);
    return;
  }
  process.stdout.write(typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
};

function log(entry) {
  appendFileSync(join(DIR, 'actions.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), tool, argv: redact(argv), ...WHO, ...entry })}\n`);
}
const redact = (args) => args.map((arg) => (arg.length > 400 ? `${arg.slice(0, 400)}...` : arg));

function lock() {
  const path = join(DIR, 'lock');
  const end = Date.now() + 8000;
  for (;;) {
    try {
      mkdirSync(path);
      return () => rmSync(path, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') die(1, `forge: cannot acquire lock: ${error.message}`);
      if (Date.now() > end) die(1, 'forge: lock acquisition timed out; ownership cannot be established safely, refusing to reclaim');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

const load = () => {
  if (WHO.container && process.platform === 'linux') {
    // The bind mount can retain the previous file size after a host write.
    const refreshed = sh('stat', ['--cached=never', '--format=%s', DIR, join(DIR, 'state.json')]);
    if (refreshed.status !== 0) die(1, `forge: cannot refresh shared state metadata: ${refreshed.stderr || refreshed.error}`);
  }
  return JSON.parse(readFileSync(join(DIR, 'state.json'), 'utf8'));
};
function save(state) {
  // Readers hold the forge lock; keeping the inode avoids stale bind-mount directory entries after replacement.
  writeFileSync(join(DIR, 'state.json'), JSON.stringify(state, null, 2));
}

// ---- derived facts: head, conflicts, checks

const headOf = (pr) => git('rev-parse', '--verify', '--quiet', `refs/heads/${pr.head}`).stdout.trim() || null;
const tipOf = (branch) => git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).stdout.trim() || null;

function conflicting(pr) {
  const base = tipOf(pr.base);
  const head = headOf(pr);
  if (base === null || head === null) return false;
  return git('merge-tree', '--write-tree', '--no-messages', base, head).status === 1;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** A new head starts the next CI wave; the first observed head uses wave 0. */
function sync(state) {
  for (const pr of Object.values(state.prs)) {
    if (pr.state !== 'OPEN') continue;
    const head = headOf(pr);
    if (head !== null && pr.ci.sha !== head) {
      if (pr.ci.sha !== null) {
        pr.ci.history.push({ sha: pr.ci.sha, state: rollup(pr) });
        pr.ci.wave += 1;
      }
      pr.ci.sha = head;
      pr.checks = clone(pr.ci.waves[Math.min(pr.ci.wave, pr.ci.waves.length - 1)] ?? []);
    }
  }
}

function rollup(pr) {
  if (pr.checks.some((check) => check.state === 'FAILURE' && !(check.pendingReads > 0))) return 'FAILURE';
  if (pr.checks.some((check) => check.pendingReads > 0 || check.state === 'PENDING')) return 'PENDING';
  return 'SUCCESS';
}

/** Reports PENDING for `pendingReads` reads of the checks, then settles on the final state. */
function readChecks(pr, consume) {
  return pr.checks.map((check) => {
    let state = check.state;
    if (check.pendingReads > 0) {
      state = 'PENDING';
      if (consume) {
        check.pendingReads -= 1;
        if (check.pendingReads === 0) check.state = check.then ?? 'SUCCESS';
      }
    }
    const bucket = state === 'SUCCESS' ? 'pass' : state === 'PENDING' ? 'pending' : 'fail';
    return { name: check.name, state, bucket, description: check.description ?? '', link: `https://github.com/${repoName(pr.repo)}/actions/runs/${check.runId}`, workflow: check.workflow ?? 'CI', runId: check.runId };
  });
}
const repoName = (repo) => `${repo.owner}/${repo.name}`;

function facts(state, pr) {
  const conflict = pr.state === 'OPEN' && conflicting(pr);
  const status = rollup(pr);
  const mergeState = pr.state !== 'OPEN' ? 'CLEAN' : conflict ? 'DIRTY' : status === 'PENDING' ? 'BLOCKED' : 'CLEAN';
  return {
    url: `https://github.com/${repoName(state.repo)}/pull/${pr.number}`,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    mergeable: pr.state !== 'OPEN' ? 'UNKNOWN' : conflict ? 'CONFLICTING' : 'MERGEABLE',
    mergeStateStatus: mergeState,
    reviewDecision: pr.reviewDecision ?? '',
    headRefOid: headOf(pr),
    headRefName: pr.head,
    baseRefName: pr.base,
    state: pr.state,
    mergedAt: pr.mergedAt,
    isDraft: pr.isDraft === true,
    isCrossRepository: false,
    comments: pr.comments,
    author: { login: pr.author },
  };
}

function pick(object, fields) {
  return Object.fromEntries(fields.map((field) => [field, object[field]]));
}

// ---- argument helpers

const flag = (name) => argv.includes(name);
const value = (...names) => {
  for (const name of names) {
    const at = argv.indexOf(name);
    if (at !== -1) return argv[at + 1];
  }
  return undefined;
};
const positionals = (skip) => {
  const found = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('-')) {
      if (skip.includes(argv[i])) i += 1;
      continue;
    }
    found.push(argv[i]);
  }
  return found;
};
const WITH_VALUE = ['--jq', '-q', '--json', '--repo', '--state', '--limit', '--title', '--body', '--body-file', '-F', '--base', '--head', '--match-head-commit', '--method', '--input', '-f', '-X', '--status', '--job', '-R', '-b', '-t', '-B', '-H'];
const bodyOf = () => {
  const inline = value('--body', '-b');
  if (inline !== undefined) return inline;
  const file = value('--body-file');
  if (file !== undefined) return file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  return '';
};

function needToken(write) {
  if (write && WHO.container && !WHO.authenticated) die(4, 'gh: To use GitHub CLI in an automated workflow, set the GH_TOKEN environment variable (the worker has no forge capability).');
}

function currentBranch() {
  return sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
}

// ---- operations on state

const comment = (pr, body, author) => pr.comments.push({ author: author || WHO.worker || ACTOR || 'operator', body, createdAt: new Date().toISOString() });

function threadsOf(pr) {
  return pr.threads.map((thread) => ({ ...thread, comments: thread.comments }));
}

function replyTo(pr, commentId, body) {
  const thread = pr.threads.find((item) => item.comments.some((entry) => String(entry.id) === String(commentId)) || item.id === commentId);
  if (thread === undefined) die(1, `gh: no review comment ${commentId}`);
  thread.comments.push({ id: `${thread.id}-r${thread.comments.length}`, in_reply_to_id: thread.comments[0].id, body, author: WHO.worker || 'operator', path: null, line: null, createdAt: new Date().toISOString() });
  return thread;
}

function mergeInto(state, pr, requested) {
  const base = tipOf(pr.base);
  const head = headOf(pr);
  const tree = git('merge-tree', '--write-tree', '--no-messages', base, head);
  if (tree.status !== 0) die(1, `gh: pull request #${pr.number} is not mergeable: merge conflict`);
  const sha = sh('git', ['--git-dir', BARE, '-c', 'user.name=forge', '-c', 'user.email=forge@example.com', 'commit-tree', tree.stdout.trim(), '-p', base, '-m', `${pr.title} (#${pr.number})`]).stdout.trim();
  git('update-ref', `refs/heads/${pr.base}`, sha, base);
  pr.state = 'MERGED';
  pr.mergedAt = new Date().toISOString();
  pr.mergedHead = head;
  log({ kind: 'merge', pr: pr.number, head, base: pr.base, mergedInto: sha, requested, tipBefore: base });
}

function runEvents(state, op, pr, text) {
  for (const event of state.events ?? []) {
    if (event.done || event.when.op !== op || (event.when.pr !== undefined && event.when.pr !== pr)) continue;
    if (event.when.match !== undefined && !new RegExp(event.when.match).test(text ?? '')) continue;
    if (event.when.verdictsFor !== undefined && !event.when.verdictsFor.every((n) => state.prs[String(n)].comments.some((entry) => /^\s*(?:PSTACK-VERDICT:\s*)?(?:PASS\+NOTES|PASS|FAIL)\b/.test(entry.body)))) continue;
    event.done = true;
    for (const step of event.do) chaos(step);
  }
}

function chaos(step) {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-chaos-'));
  const env = { ...process.env, FORGE_ACTOR: 'operator-sim', PSTACK_WORKER_ID: '', GIT_TERMINAL_PROMPT: '0' };
  const run = (...args) => {
    const result = sh('git', ['-C', tmp, '-c', 'user.name=operator', '-c', 'user.email=op@example.com', '-c', 'commit.gpgsign=false', ...args], { env });
    if (result.status !== 0) die(1, `forge chaos: git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  sh('git', ['clone', '-q', BARE, tmp], { env });
  try {
    if (step.type === 'advance-trunk') {
      run('checkout', '-q', '-B', step.branch, `origin/${step.branch}`);
      writeFileSync(join(tmp, step.file), step.content);
      run('add', '-A');
      run('commit', '-q', '-m', step.message ?? 'trunk moves');
      run('push', '-q', 'origin', step.branch);
    } else if (step.type === 'rebase') {
      let newBase = `origin/${step.onto}`;
      let oldBase = null;
      for (const branch of step.branches) {
        const old = run('rev-parse', `origin/${branch}`);
        run('checkout', '-q', '-B', branch, `origin/${branch}`);
        const upstream = oldBase ?? run('merge-base', `origin/${step.onto}~1`, old);
        const rebased = sh('git', ['-C', tmp, '-c', 'user.name=operator', '-c', 'user.email=op@example.com', '-c', 'core.editor=true', 'rebase', '-q', '--onto', newBase, upstream, branch], { env });
        if (rebased.status !== 0) {
          const fix = step.resolve?.[branch];
          if (fix === undefined) die(1, `forge chaos: rebase of ${branch} conflicts: ${rebased.stderr}`);
          writeFileSync(join(tmp, fix.file), fix.content);
          run('add', '-A');
          const continued = sh('git', ['-C', tmp, '-c', 'user.name=operator', '-c', 'user.email=op@example.com', '-c', 'core.editor=true', 'rebase', '--continue'], { env });
          if (continued.status !== 0) die(1, `forge chaos: rebase --continue: ${continued.stderr}`);
        }
        const edit = step.edits?.[branch];
        if (edit !== undefined) {
          writeFileSync(join(tmp, edit.file), edit.content);
          run('add', '-A');
          run('commit', '-q', '--amend', '--no-edit');
        }
        run('push', '-q', '--force', 'origin', branch);
        oldBase = old;
        newBase = branch;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- gh

function graphql(state) {
  const stdin = flag('--input') ? (value('--input') === '-' ? readFileSync(0, 'utf8') : readFileSync(value('--input'), 'utf8')) : null;
  const fields = {};
  for (let i = 0; i < argv.length; i += 1) if (['-f', '-F', '--raw-field', '--field'].includes(argv[i])) {
    const [key, ...rest] = argv[i + 1].split('=');
    fields[key] = rest.join('=');
  }
  const input = stdin === null ? { query: fields.query, variables: fields } : JSON.parse(stdin);
  const query = String(input.query ?? '');
  const variables = input.variables ?? fields;
  const numberArgument = /\bpullRequest\s*\(\s*number\s*:\s*(\$[A-Za-z_]\w*|\d+)/.exec(query)?.[1];
  const number = numberArgument?.startsWith('$') ? variables[numberArgument.slice(1)] : numberArgument;
  const pr = state.prs[String(number ?? '')];
  if (/resolveReviewThread/.test(query)) {
    needToken(true);
    const argument = /\bresolveReviewThread\s*\(\s*input\s*:\s*(\$[A-Za-z_]\w*|\{[^}]*\})/.exec(query)?.[1];
    const field = argument?.startsWith('$') ? variables[argument.slice(1)]?.threadId : /\bthreadId\s*:\s*(\$[A-Za-z_]\w*|"[^"]*")/.exec(argument ?? '')?.[1];
    const threadId = typeof field === 'string' && field.startsWith('$') ? variables[field.slice(1)] : typeof field === 'string' && field.startsWith('"') ? JSON.parse(field) : field;
    const found = Object.values(state.prs).find((item) => item.threads.some((thread) => thread.id === threadId));
    if (found === undefined) die(1, 'gh: thread not found');
    found.threads.find((thread) => thread.id === threadId).resolved = true;
    log({ kind: 'resolve', pr: found.number, thread: threadId });
    return out({ data: { resolveReviewThread: { thread: { id: threadId } } } });
  }
  if (/addPullRequestReviewThreadReply/.test(query)) {
    needToken(true);
    const found = Object.values(state.prs).find((item) => item.threads.some((thread) => thread.id === variables.thread));
    if (found === undefined) die(1, 'gh: thread not found');
    replyTo(found, variables.thread, String(variables.body));
    log({ kind: 'reply', pr: found.number, thread: variables.thread, body: String(variables.body) });
    return out({ data: { addPullRequestReviewThreadReply: { comment: { id: 'new' } } } });
  }
  if (pr === undefined) die(1, 'gh: unknown pull request');
  if (/\breviewThreads\s*\(/.test(query)) {
    log({ kind: 'read', what: 'threads', pr: pr.number });
    const nodes = pr.threads.map((thread) => ({ id: thread.id, isResolved: thread.resolved, isOutdated: false, path: thread.comments[0]?.path ?? null, line: thread.comments[0]?.line ?? null, comments: { nodes: thread.comments.map((entry) => ({ id: entry.id, databaseId: entry.id, body: entry.body, createdAt: entry.createdAt, path: entry.path ?? null, line: entry.line ?? null, author: { login: entry.author } })) } }));
    return out({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } });
  }
  if (/PrCheckRollup/.test(query)) {
    log({ kind: 'read', what: 'rollup', pr: pr.number });
    const nodes = readChecks(pr, true).map((check) => ({ __typename: 'CheckRun', name: check.name, status: check.state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED', conclusion: check.state === 'SUCCESS' ? 'SUCCESS' : check.state === 'FAILURE' ? 'FAILURE' : null, detailsUrl: check.link }));
    return out({ data: { repository: { pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }] } } } } });
  }
  if (/PrCommitStatuses/.test(query)) {
    const nodes = [...pr.ci.history.map((entry) => ({ commit: { oid: entry.sha, statusCheckRollup: { state: entry.state } } })), { commit: { oid: headOf(pr), statusCheckRollup: { state: rollup(pr) } } }];
    return out({ data: { repository: { pullRequest: { commits: { nodes } } } } });
  }
  die(1, `gh: unsupported graphql query ${query.slice(0, 60)}`);
}

function gh(state) {
  const [group, verb, ...rest] = argv;
  void rest;
  if (group === 'repo' && verb === 'view') {
    const repo = { name: state.repo.name, owner: { login: state.repo.owner }, nameWithOwner: repoName(state.repo), url: `https://github.com/${repoName(state.repo)}`, defaultBranchRef: { name: state.repo.trunk } };
    log({ kind: 'read', what: 'repo' });
    const fields = (value('--json') ?? '').split(',').filter(Boolean);
    return out(fields.length === 0 ? `${repo.nameWithOwner}\n` : pick(repo, fields));
  }
  if (group === 'auth') {
    if (WHO.container && value('--hostname') === 'github.com') die(1, 'fake forge has no github.com credentials');
    if (verb === 'token') {
      if (state.noToken) die(1, 'no oauth token found for github.com');
      return out('ghs_fake_forge_token\n');
    }
    return out('Logged in to github.com (fake forge)\n');
  }
  if (group === 'api') {
    const target = argv.find((arg) => /^repos\//.test(arg) || arg === 'graphql');
    if (target === 'graphql') return graphql(state);
    const comments = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/comments$/.exec(target ?? '');
    if (comments !== null && (value('--method', '-X') ?? 'GET').toUpperCase() === 'GET') {
      const pr = state.prs[comments[1]];
      if (pr === undefined) die(1, 'gh: unknown pull request');
      log({ kind: 'read', what: 'review-comments', pr: pr.number });
      return out(pr.threads.flatMap((thread) => thread.comments.map((entry) => ({ id: entry.id, body: entry.body, user: { login: entry.author }, path: entry.path ?? null, line: entry.line ?? null, created_at: entry.createdAt, ...(entry.in_reply_to_id === undefined ? {} : { in_reply_to_id: entry.in_reply_to_id }) }))));
    }
    const reply = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/comments\/([^/]+)\/replies$/.exec(target ?? '');
    if (reply !== null && String(value('--method', '-X')).toUpperCase() === 'POST') {
      needToken(true);
      const pr = state.prs[reply[1]];
      if (pr === undefined) die(1, 'gh: unknown pull request');
      const payload = JSON.parse(readFileSync(value('--input') === '-' ? 0 : value('--input'), 'utf8'));
      const thread = replyTo(pr, reply[2], String(payload.body));
      log({ kind: 'reply', pr: pr.number, thread: thread.id, body: String(payload.body) });
      return out({ id: thread.comments.at(-1).id, body: payload.body });
    }
    die(1, `gh: unsupported api call ${target}`);
  }
  if (group === 'run') {
    const id = positionals(WITH_VALUE)[2] ?? positionals(WITH_VALUE)[1];
    const holder = Object.values(state.prs).find((pr) => pr.checks.some((check) => String(check.runId) === String(id)));
    if (holder === undefined) die(1, `gh: no workflow run ${id}`);
    const check = holder.checks.find((item) => String(item.runId) === String(id));
    if (verb === 'view') {
      log({ kind: 'log-view', pr: holder.number, runId: String(id) });
      return out(`${check.log ?? ''}\n`);
    }
    if (verb === 'rerun') {
      needToken(true);
      const jobRetry = flag('--failed') || flag('--job');
      log({ kind: 'rerun', pr: holder.number, runId: String(id), retry: jobRetry ? 'job-retry' : 'fresh-build', name: check.name });
      const plan = check.rerun ?? { pendingReads: 1, then: 'SUCCESS' };
      check.state = 'PENDING';
      check.pendingReads = plan.pendingReads;
      check.then = plan.then;
      check.reruns = (check.reruns ?? 0) + 1;
      return out(`Requested rerun of run ${id}\n`);
    }
  }
  if (group !== 'pr') die(1, `gh: unsupported command ${group}`);
  const numberArg = positionals(WITH_VALUE).slice(2).find((arg) => /^\d+$/.test(arg));
  const find = () => {
    if (numberArg !== undefined) return state.prs[numberArg];
    const branch = currentBranch();
    return Object.values(state.prs).find((pr) => pr.head === branch);
  };
  if (verb === 'list') {
    log({ kind: 'read', what: 'list' });
    const open = Object.values(state.prs).filter((pr) => pr.state === 'OPEN').map((pr) => facts(state, pr));
    return out(open.map((item) => pick(item, ['number', 'headRefName', 'baseRefName', 'isCrossRepository'])));
  }
  if (verb === 'create') {
    needToken(true);
    const head = value('--head', '-H') ?? currentBranch();
    const number = state.reserve?.[head] ?? Math.max(0, ...Object.keys(state.prs).map(Number)) + 1;
    const body = bodyOf();
    state.prs[String(number)] = newPr(state, { number, title: value('--title', '-t') ?? head, body, base: value('--base', '-B') ?? state.repo.trunk, head, author: WHO.worker || 'operator', isDraft: flag('--draft') });
    log({ kind: 'create', pr: number, base: value('--base', '-B') ?? state.repo.trunk, head, draft: flag('--draft'), body });
    return out(`https://github.com/${repoName(state.repo)}/pull/${number}\n`);
  }
  const pr = find();
  if (pr === undefined) die(1, `gh: no pull request found`);
  if (verb === 'diff') {
    const result = git('diff', ...(flag('--name-only') ? ['--name-only'] : flag('--stat') ? ['--stat'] : []), `${tipOf(pr.base)}...${headOf(pr)}`);
    if (result.status !== 0) die(1, result.stderr);
    log({ kind: 'read', what: 'diff', pr: pr.number });
    return out(result.stdout);
  }
  if (verb === 'view') {
    const all = facts(state, pr);
    log({ kind: 'read', what: 'view', pr: pr.number });
    const fields = (value('--json') ?? '').split(',').filter(Boolean);
    return out(fields.length === 0 ? `#${pr.number} ${pr.title}\n${all.state}\n` : pick(all, fields));
  }
  if (verb === 'checks') {
    const checks = readChecks(pr, true);
    log({ kind: 'read', what: 'checks', pr: pr.number });
    const code = checks.some((check) => check.bucket === 'fail') ? 1 : checks.some((check) => check.bucket === 'pending') ? 8 : 0;
    out(flag('--json') ? checks.map((check) => pick(check, (value('--json') ?? '').split(',').filter(Boolean))) : checks.map((check) => `${check.name}\t${check.bucket}\t${check.link}`).join('\n') + '\n');
    save(state);
    process.exit(code);
  }
  if (verb === 'comment') {
    needToken(true);
    const body = bodyOf();
    comment(pr, body);
    log({ kind: 'comment', pr: pr.number, body });
    return runEvents(state, 'comment', pr.number, body);
  }
  if (verb === 'edit') {
    needToken(true);
    const base = value('--base', '-B');
    if (base !== undefined) {
      log({ kind: 'edit-base', pr: pr.number, from: pr.base, to: base });
      pr.base = base;
    }
    return undefined;
  }
  if (verb === 'ready') {
    needToken(true);
    pr.isDraft = false;
    log({ kind: 'ready', pr: pr.number });
    return undefined;
  }
  if (verb === 'merge') {
    needToken(true);
    const match = value('--match-head-commit');
    if (match !== undefined && match !== headOf(pr)) {
      log({ kind: 'merge-refused', pr: pr.number, why: 'head moved', head: headOf(pr), requested: match });
      die(1, 'gh: head commit mismatch, not merging');
    }
    if (flag('--auto')) {
      pr.autoMerge = true;
      log({ kind: 'auto-merge', pr: pr.number, head: headOf(pr) });
      return out(`Pull request #${pr.number} will be automatically merged when ready\n`);
    }
    if (state.queue) {
      pr.queued = true;
      log({ kind: 'merge-queued', pr: pr.number, head: headOf(pr) });
      return out(`Pull request #${pr.number} added to the merge queue\n`);
    }
    mergeInto(state, pr, match ?? null);
    return out(`Merged pull request #${pr.number}\n`);
  }
  die(1, `gh: unsupported pr ${verb}`);
}

function newPr(state, fields) {
  const waves = fields.waves ?? [[{ name: 'build', workflow: 'CI', runId: 9000 + fields.number, state: 'SUCCESS' }]];
  return { repo: state.repo, baseAtStart: fields.base, state: 'OPEN', mergedAt: null, isDraft: false, reviewDecision: '', comments: [], threads: [], checks: [], ci: { waves, wave: 0, sha: null, history: [] }, ...fields };
}

// ---- origin

function origin(state) {
  const [group, verb, ...rest] = argv;
  if (group !== 'pr') die(1, `origin: unsupported command ${group}`);
  const args = rest;
  const numberOf = (list) => list.find((arg) => /^\d+$/.test(arg));
  if (verb === 'create') {
    needToken(true);
    const head = value('--head') ?? currentBranch();
    const number = state.reserve?.[head] ?? Math.max(0, ...Object.keys(state.prs).map(Number)) + 1;
    state.prs[String(number)] = newPr(state, { number, title: value('--title') ?? head, body: bodyOf(), base: value('--base') ?? state.repo.trunk, head, author: WHO.worker || 'operator', isDraft: value('--status') === 'draft' });
    log({ kind: 'create', pr: number, base: value('--base') ?? state.repo.trunk, head, draft: value('--status') === 'draft', body: bodyOf() });
    return out(`opened PR ${number}\n`);
  }
  if (verb === 'thread') {
    const sub = args[0];
    if (sub === 'list') {
      const pr = state.prs[numberOf(args.slice(1))];
      log({ kind: 'read', what: 'threads', pr: pr.number });
      return out(pr.threads.filter((thread) => !thread.resolved).map((thread) => ({ id: thread.id, resolved: thread.resolved, author: thread.comments[0]?.author, body: thread.comments[0]?.body, path: thread.comments[0]?.path, line: thread.comments[0]?.line })));
    }
    if (sub === 'reply') {
      needToken(true);
      const [threadId, prNumber] = args.slice(1).filter((arg) => !arg.startsWith('-') && arg !== value('--body-file'));
      const pr = state.prs[prNumber];
      const thread = pr.threads.find((item) => item.id === threadId);
      if (thread === undefined) die(1, `origin: no thread ${threadId}`);
      const reply = readFileSync(value('--body-file'), 'utf8');
      thread.comments.push({ id: `${thread.id}-r`, body: reply, author: WHO.worker || 'operator', createdAt: new Date().toISOString() });
      log({ kind: 'reply', pr: pr.number, thread: thread.id, body: reply });
      return undefined;
    }
    if (sub === 'resolve') {
      needToken(true);
      const [threadId, prNumber] = args.slice(1).filter((arg) => !arg.startsWith('-'));
      const thread = state.prs[prNumber].threads.find((item) => item.id === threadId);
      thread.resolved = true;
      log({ kind: 'resolve', pr: Number(prNumber), thread: threadId });
      return undefined;
    }
    die(1, `origin: unsupported thread ${sub}`);
  }
  const pr = state.prs[numberOf(args)];
  if (pr === undefined) die(1, 'origin: no such pull request');
  if (verb === 'view') {
    const checks = readChecks(pr, false);
    const open = pr.threads.filter((thread) => !thread.resolved);
    const all = facts(state, pr);
    const blockers = [...(all.mergeable === 'CONFLICTING' ? ['merge-conflict'] : []), ...(open.length > 0 ? ['unresolved-threads'] : []), ...checks.filter((check) => check.bucket !== 'pass').map((check) => `check:${check.name}:${check.bucket}`)];
    log({ kind: 'read', what: 'view', pr: pr.number });
    return out({ number: pr.number, state: pr.state, base: pr.base, head: headOf(pr), mergeable: blockers.length === 0, blockers, ...(flag('--checks') ? { checks } : {}), ...(flag('--comments') ? { comments: pr.comments } : {}) });
  }
  if (verb === 'checks') {
    let checks = readChecks(pr, true);
    log({ kind: 'read', what: 'checks', pr: pr.number });
    if (flag('--watch')) while (checks.some((check) => check.bucket === 'pending')) {
      checks = readChecks(pr, true);
      save(state);
    }
    out(checks);
    save(state);
    process.exit(checks.some((check) => check.bucket === 'fail') ? 1 : 0);
  }
  if (verb === 'edit') {
    needToken(true);
    const base = value('--base');
    log({ kind: 'edit-base', pr: pr.number, from: pr.base, to: base });
    pr.base = base;
    return undefined;
  }
  if (verb === 'ready') {
    needToken(true);
    pr.isDraft = false;
    log({ kind: 'ready', pr: pr.number });
    return undefined;
  }
  if (verb === 'merge') {
    needToken(true);
    const chain = [pr];
    while (chain[0].base !== state.repo.trunk) {
      const below = Object.values(state.prs).find((item) => item.head === chain[0].base && item.state === 'OPEN');
      if (below === undefined) break;
      chain.unshift(below);
    }
    for (const item of chain) mergeInto(state, item, null);
    return out(`merged ${chain.map((item) => item.number).join(', ')}\n`);
  }
  die(1, `origin: unsupported pr ${verb}`);
}

// ---- main

if (!['gh', 'origin'].includes(tool)) die(2, 'usage: forge-cli.mjs gh|origin <args>');
if (!existsSync(join(DIR, 'state.json'))) die(1, `forge: no state under ${DIR}`);
const release = lock();
process.on('exit', release);
try {
  const state = load();
  sync(state);
  const before = JSON.stringify(state);
  (tool === 'gh' ? gh : origin)(state);
  void before;
  save(state);
} finally {
  release();
}
