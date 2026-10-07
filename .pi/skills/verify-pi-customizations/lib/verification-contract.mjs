import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const APPROVAL_SCHEMA_VERSION = 1;

// Dependencies, build output, and captured artifacts are not contract sources. Without this the
// approvals digest would churn on every install and every drive.
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.nyc_output', 'artifacts', '.cache', 'tmp']);
const CONTRACT_MODES = new Set(['100644', '100755']);
const APPROVAL_FIELDS = new Set(['schema_version', 'sha256']);
const APPROVAL_SHA256 = /^[0-9a-f]{64}$/;
const SKILL_ROOT = '.pi/skills/verify-pi-customizations';

// A receipt is only evidence for the harness that produced it, so the digest spans the skill and
// every extension's test and script helpers, not only the scenario files.
function rootsFor(repoRoot) {
  const roots = [join(repoRoot, SKILL_ROOT)];
  const extensions = join(repoRoot, 'extensions');
  let entries;
  try {
    entries = readdirSync(extensions, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return roots;
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    roots.push(join(extensions, name, 'test'), join(extensions, name, 'scripts'));
  }
  return roots;
}

function walk(dir, repoRoot, paths) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    const repoRelative = relative(repoRoot, absolute).split(sep).join('/');
    // Checked before the directory branch so a symlinked directory is rejected too.
    if (entry.isSymbolicLink()) throw new Error(`verification contract source is a symlink: ${repoRelative}`);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(absolute, repoRoot, paths);
      continue;
    }
    if (!entry.isFile()) throw new Error(`verification contract source is not a regular file: ${repoRelative}`);
    paths.push(repoRelative);
  }
}

function contractPaths(repoRoot) {
  const paths = [];
  for (const root of rootsFor(repoRoot)) walk(root, repoRoot, paths);
  return paths.sort();
}

function isContractSource(repoRoot, path) {
  const underRoot = rootsFor(repoRoot).some((root) => {
    const prefix = relative(repoRoot, root).split(sep).join('/');
    return path.startsWith(`${prefix}/`);
  });
  if (!underRoot) return false;
  return !path.split('/').some((segment) => EXCLUDED_DIRS.has(segment));
}

export function contractDigest({ repoRoot }) {
  const hash = createHash('sha256');
  for (const relativePath of contractPaths(repoRoot)) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(join(repoRoot, relativePath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function contractUnchangedSince({ repoRoot, commit }) {
  if (typeof commit !== 'string' || commit.length === 0) return false;
  let paths;
  try {
    paths = contractPaths(repoRoot);
  } catch {
    return false;
  }
  try {
    const current = new Map();
    if (paths.length > 0) {
      const output = execFileSync('git', ['-C', repoRoot, 'hash-object', '--stdin-paths'], { input: `${paths.join('\n')}\n`, encoding: 'utf8' });
      const blobs = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      paths.forEach((path, index) => {
        current.set(path, blobs[index]);
      });
    }
    const listing = execFileSync('git', ['-C', repoRoot, 'ls-tree', '-r', commit], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const committed = new Map();
    for (const line of listing.split('\n')) {
      if (line === '') continue;
      const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(line);
      if (!match) continue;
      const [, mode, sha, path] = match;
      if (!CONTRACT_MODES.has(mode) || !isContractSource(repoRoot, path)) continue;
      committed.set(path, sha);
    }
    if (current.size !== committed.size) return false;
    for (const [path, sha] of current) {
      if (committed.get(path) !== sha) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function loadApproval({ path }) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`approval record ${path} is not valid JSON: ${error.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`approval record ${path} must be a JSON object`);
  for (const key of Object.keys(parsed)) {
    if (!APPROVAL_FIELDS.has(key)) throw new Error(`approval record ${path} has unknown field '${key}'`);
  }
  if (parsed.schema_version !== APPROVAL_SCHEMA_VERSION) throw new Error(`approval record ${path} has an unsupported schema version ${JSON.stringify(parsed.schema_version)}`);
  if (typeof parsed.sha256 !== 'string' || !APPROVAL_SHA256.test(parsed.sha256)) throw new Error(`approval record ${path} sha256 must be 64 lowercase hex characters`);
  return { schemaVersion: parsed.schema_version, sha256: parsed.sha256 };
}
