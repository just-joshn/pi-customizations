#!/usr/bin/env node
// The owner stand-in for the real-forge babysit run. It waits for a PR comment that asks for a rebase, rebases the branch
// onto trunk (resolving the conflict from the config), force-pushes it with a lease, then leaves a review thread on the new
// head, the way a review bot answers a new push. Every step is appended to the log as JSON, so a checker can tell the
// owner's push from the babysitter's. Usage: node real-forge-operator.mjs <config.json>
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { repo, trunk, log, pr, branch, resolve, thread, match = 'rebase', timeoutSeconds = 1500 } = config;
const url = `https://github.com/${repo}.git`;
const record = (entry) => appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
const sh = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...options });
const gh = (...args) => sh('gh', args);
const sleep = (seconds) => sh('sleep', [String(seconds)]);
const identity = { GIT_AUTHOR_NAME: config.owner, GIT_AUTHOR_EMAIL: `${config.owner}@users.noreply.github.com`, GIT_COMMITTER_NAME: config.owner, GIT_COMMITTER_EMAIL: `${config.owner}@users.noreply.github.com`, GIT_EDITOR: 'true' };

const deadline = Date.now() + timeoutSeconds * 1000;
let asked = false;
while (!asked && Date.now() < deadline) {
  const comments = JSON.parse(gh('api', `repos/${repo}/issues/${pr}/comments?per_page=100`).stdout || '[]');
  asked = comments.some((comment) => new RegExp(match, 'i').test(comment.body));
  if (!asked) sleep(2);
}
if (!asked) {
  record({ kind: 'timeout' });
  process.exit(1);
}
record({ kind: 'asked' });

const dir = mkdtempSync(join(tmpdir(), 'real-operator-'));
try {
  const git = (...args) => {
    const run = sh('git', ['-C', dir, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', '-c', 'commit.gpgsign=false', ...args], { env: { ...process.env, ...identity } });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
  };
  git('clone', '-q', url, '.');
  git('checkout', '-q', '-B', 'work', `origin/${branch}`);
  const old = git('rev-parse', 'HEAD');
  const rebased = sh('git', ['-C', dir, 'rebase', '-q', `origin/${trunk}`], { env: { ...process.env, ...identity } });
  if (rebased.status !== 0) {
    mkdirSync(join(dir, resolve.file, '..'), { recursive: true });
    writeFileSync(join(dir, resolve.file), resolve.content);
    git('add', '-A');
    git('rebase', '--continue');
  }
  const next = git('rev-parse', 'HEAD');
  git('push', '-q', `--force-with-lease=refs/heads/${branch}:${old}`, 'origin', `HEAD:refs/heads/${branch}`);
  record({ kind: 'force-push', branch, old, new: next });

  while (JSON.parse(gh('api', `repos/${repo}/pulls/${pr}`).stdout).head.sha !== next && Date.now() < deadline) sleep(2);
  const review = { commit_id: next, event: 'COMMENT', body: '', comments: [{ path: thread.path, line: thread.line, side: 'RIGHT', body: thread.body }] };
  const posted = sh('gh', ['api', '--method', 'POST', `repos/${repo}/pulls/${pr}/reviews`, '--input', '-'], { input: JSON.stringify(review) });
  if (posted.status !== 0) throw new Error(`review: ${posted.stderr}`);
  record({ kind: 'review-thread', head: next, path: thread.path, line: thread.line });
} catch (error) {
  record({ kind: 'error', message: String(error).slice(0, 400) });
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
