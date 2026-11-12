#!/usr/bin/env node
// Runs the test suite on a GitHub Actions Linux runner and downloads the Vitest JSON results, so the tests that skip off Linux
// (bubblewrap, seccomp) can feed the parity manifest.
//   node scripts/ci-linux.mjs [--repo owner/name] [--out generated/ci-results] [--no-wait]
// It pushes a snapshot of the git-tracked package files (never the working tree, never anything outside this package) to a
// ci/<commit>-<time> branch of the sandbox repo, authenticated by `gh auth git-credential` for that one command.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { repo: { type: 'string' }, out: { type: 'string' }, root: { type: 'string' } } });
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const repo = values.repo ?? 'just-joshn/pstack-parity-sandbox';
const out = resolve(root, values.out ?? 'generated/ci-results');
const EXCLUDE = /^(generated\/ci-results\/|node_modules\/)/;

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
const gh = (...args) => run('gh', args);

if (run('git', ['-C', root, 'status', '--porcelain', '--', '.'])) {
  console.error('ci-linux: the package has uncommitted changes; commit first so the result names the code it ran against');
  process.exit(1);
}
const commit = run('git', ['-C', root, 'rev-parse', 'HEAD']);
const branch = `ci/${commit.slice(0, 12)}-${Math.floor(Date.now() / 1000)}`;

const snapshot = mkdtempSync(join(tmpdir(), 'pstack-ci-'));
try {
  const files = run('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 1 << 28 }).split('\0').filter((f) => f && !EXCLUDE.test(f));
  for (const f of files) {
    mkdirSync(dirname(join(snapshot, f)), { recursive: true });
    cpSync(join(root, f), join(snapshot, f));
  }
  mkdirSync(join(snapshot, '.github/workflows'), { recursive: true });
  copyFileSync(join(root, 'scripts/ci-linux/workflow.yml'), join(snapshot, '.github/workflows/linux-tests.yml'));
  writeFileSync(join(snapshot, 'ci-snapshot.json'), `${JSON.stringify({ commit, files: files.length })}\n`);
  const git = (...args) => run('git', ['-C', snapshot, ...args]);
  git('init', '-q', '-b', branch);
  git('add', '-A');
  git('-c', 'user.name=pstack-ci', '-c', 'user.email=pstack-ci@users.noreply.github.com', 'commit', '-q', '-m', `snapshot of ${commit}`);
  git('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '-q', `https://github.com/${repo}.git`, `${branch}:${branch}`);
  console.log(`pushed ${files.length} files as ${branch}`);
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}

let id;
for (let i = 0; i < 40 && !id; i++) {
  const runs = JSON.parse(gh('run', 'list', '-R', repo, '--branch', branch, '--json', 'databaseId', '-L', '1'));
  id = runs[0]?.databaseId;
  if (!id) spawnSync('sleep', ['3']);
}
if (!id) {
  console.error('ci-linux: no workflow run appeared for the pushed branch');
  process.exit(1);
}
console.log(`run https://github.com/${repo}/actions/runs/${id}`);
spawnSync('gh', ['run', 'watch', String(id), '-R', repo, '--interval', '10'], { stdio: ['ignore', 'ignore', 'inherit'] });
const view = JSON.parse(gh('run', 'view', String(id), '-R', repo, '--json', 'conclusion,url,jobs,createdAt,updatedAt'));
console.log(JSON.stringify({ conclusion: view.conclusion, url: view.url, jobs: view.jobs.map((j) => ({ name: j.name, conclusion: j.conclusion, steps: j.steps.map((s) => `${s.name}: ${s.conclusion}`) })) }, null, 2));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const dl = spawnSync('gh', ['run', 'download', String(id), '-R', repo, '-n', 'linux-results', '-D', out], { stdio: 'inherit' });
if (dl.status !== 0 || !existsSync(join(out, 'linux-security.json'))) {
  console.error('ci-linux: no results artifact was downloaded');
  process.exit(1);
}
for (const name of ['linux-security', 'linux-full']) {
  const path = join(out, `${name}.json`);
  if (!existsSync(path)) continue;
  const r = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`${name}: ${r.numPassedTests} passed, ${r.numFailedTests} failed, ${r.numPendingTests} skipped of ${r.numTotalTests}`);
}
process.exit(view.conclusion === 'success' ? 0 : 2);
