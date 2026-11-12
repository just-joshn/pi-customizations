#!/usr/bin/env node
// Moves the vendored upstream pin. A pin move that changes any vendored file is refused unless a parity
// review record accompanies it (--review), so a source upgrade cannot bypass the parity gates.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { revision: { type: 'string' }, review: { type: 'string' }, root: { type: 'string' }, 'dry-run': { type: 'boolean' }, repository: { type: 'string' } } });
const pkgRoot = resolve(values.root ?? root);
const repository = values.repository ?? 'https://github.com/cursor/plugins.git';
const pkgPath = join(pkgRoot, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const oldRevision = pkg.pstackSource.revision;
const revision = values.revision ?? oldRevision;
if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error(`--revision must be a full 40-character commit id, got "${revision}"`);

const SOURCES = [
  ['pstack', 'vendor/upstream-pstack', ['skills', 'agents', 'automations', 'docs', 'assets', '.cursor-plugin', 'plugin.json', 'README.md', 'LICENSE']],
  ['cursor-team-kit', 'vendor/upstream-cursor-team-kit', ['skills']],
];
// Files that spell the pinned revision literally. The sync rewrites them so they cannot lag the lock.
const PIN_FILES = [
  'adapters/provenance.ts',
  'adapters/cursor-to-pi.ts',
  'scripts/start-run.mjs',
  'README.md',
  'docs/parity-status.md',
  'tests/skill-parity/review-fixes.test.ts',
  'tests/integration/commands.test.ts',
  'tests/integration/pi-load.test.ts',
  'tests/todo/start-run.test.ts',
];

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
function hashTree(base) {
  const files = {};
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[relative(base, path).split('\\').join('/')] = sha(readFileSync(path));
      else throw new Error(`Unsupported upstream entry: ${path}`);
    }
  };
  for (const [, destination] of SOURCES) visit(join(base, destination));
  return files;
}

const temp = mkdtempSync(join(tmpdir(), 'pstack-upstream-'));
try {
  execFileSync('git', ['init', '-q', temp]);
  execFileSync('git', ['-C', temp, 'fetch', '-q', '--filter=blob:none', repository, revision], { stdio: 'inherit' });
  execFileSync('git', ['-C', temp, 'checkout', '-q', '--detach', revision], { stdio: 'inherit' });
  const lastChange = execFileSync('git', ['-C', temp, 'log', '-1', '--format=%H', revision, '--', 'pstack'], { encoding: 'utf8' }).trim();
  const stage = join(temp, '.stage');
  for (const [source, destination, entries] of SOURCES) {
    mkdirSync(join(stage, destination), { recursive: true });
    for (const entry of entries) cpSync(join(temp, source, entry), join(stage, destination, entry), { recursive: true, preserveTimestamps: false });
  }
  const files = hashTree(stage);
  const lockPath = join(pkgRoot, 'generated/upstream-lock.json');
  const hasLock = existsSync(lockPath);
  const oldFiles = hasLock ? JSON.parse(readFileSync(lockPath, 'utf8')).files : {};
  const added = hasLock ? Object.keys(files).filter((f) => !(f in oldFiles)) : [];
  const removed = Object.keys(oldFiles).filter((f) => !(f in files));
  const changed = Object.keys(files).filter((f) => f in oldFiles && files[f] !== oldFiles[f]);
  const changedFiles = [...added, ...removed, ...changed].sort();
  const contentChanged = changedFiles.length > 0;
  const pluginVersion = JSON.parse(readFileSync(join(stage, 'vendor/upstream-pstack/plugin.json'), 'utf8')).version;
  console.log(`pin ${oldRevision.slice(0, 8)} -> ${revision.slice(0, 8)}: ${added.length} added, ${removed.length} removed, ${changed.length} changed vendored file(s)`);

  let review = null;
  if (contentChanged) {
    if (!values.review) throw new Error(`The pin move changes ${changedFiles.length} vendored file(s). Review each against the parity manifest, then rerun with --review <file> naming them. Nothing was written.`);
    review = JSON.parse(readFileSync(resolve(values.review), 'utf8'));
    const named = [...(review.changedFiles ?? [])].sort().join('\n');
    if (review.from !== oldRevision || review.to !== revision || !review.reviewer || !review.notes || named !== changedFiles.join('\n')) {
      throw new Error('The review record does not match this pin move: it needs from, to, reviewer, notes, and changedFiles equal to the files that changed. Nothing was written.');
    }
  }
  if (values['dry-run']) process.exit(0);

  for (const [, destination] of SOURCES) {
    rmSync(join(pkgRoot, destination), { recursive: true, force: true });
    cpSync(join(stage, destination), join(pkgRoot, destination), { recursive: true });
  }
  const counts = {
    files: Object.keys(files).length,
    pstackSkills: readdirSync(join(pkgRoot, 'vendor/upstream-pstack/skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).length,
    teamKitSkills: readdirSync(join(pkgRoot, 'vendor/upstream-cursor-team-kit/skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).length,
  };
  mkdirSync(join(pkgRoot, 'generated'), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify({ repository, revision, counts, files }, null, 2)}\n`);

  pkg.pstackSource = { ...pkg.pstackSource, revision, version: pluginVersion, lastChange };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  if (oldRevision !== revision) {
    for (const file of PIN_FILES) {
      const path = join(pkgRoot, file);
      if (existsSync(path)) writeFileSync(path, readFileSync(path, 'utf8').split(oldRevision).join(revision));
    }
  }

  const logPath = join(pkgRoot, 'generated/source-review-log.json');
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : { entries: [] };
  if (oldRevision !== revision || log.entries.length === 0) {
    log.entries.push({ from: oldRevision, to: revision, contentChanged, changedFiles, review: review && { reviewer: review.reviewer, notes: review.notes } });
    writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`);
  }
  console.log(`Synced ${counts.files} files at ${revision} (pstack last changed at ${lastChange}, ${contentChanged ? 'content changed, review recorded' : 'no vendored content change'})`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
