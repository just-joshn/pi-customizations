#!/usr/bin/env node
// Copies the pinned pstack plugin and the three cursor-team-kit skills it depends on into this package.
// Usage: sync-upstream.mjs --source <cursor/plugins checkout> [--check]
// Files are read with `git show <commit>:<path>`, so the checkout's working tree does not matter.
// --check regenerates in memory and exits 1 on any difference from the files and lock on disk.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = {
  repository: 'https://github.com/cursor/plugins',
  commit: '997ffc7fe26bdaa6478a14e7f5b8d5f9ed747102',
  pstackVersion: '0.15.21',
  teamKitVersion: '1.2.0',
};

export const AUTHORED = ['skills/create-skill/SKILL.md'];

const TEAM_KIT_SKILLS = ['deslop', 'control-cli', 'control-ui'];
const STANDARD_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(packageRoot, 'upstream.lock.json');

// worktree-audit.sh is executable code, so it cannot reinterpret Cursor's transcript path the way the model can.
// The patch text lives in patches.json because it is shell source full of `${...}`.
export const PATCHES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'patches.json'), 'utf8'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Maps an upstream path to its place in this package, or undefined when the file does not ship. */
export function targetFor(source) {
  const teamKit = /^cursor-team-kit\/skills\/([^/]+)\/(.+)$/.exec(source);
  if (teamKit) return TEAM_KIT_SKILLS.includes(teamKit[1]) ? `skills/${teamKit[1]}/${teamKit[2]}` : undefined;
  if (source === 'pstack/LICENSE') return 'licenses/pstack.LICENSE';
  if (source === 'cursor-team-kit/LICENSE') return 'licenses/cursor-team-kit.LICENSE';
  const pstack = /^pstack\/((?:skills|agents|automations)\/.+|docs\/guide\/.+)$/.exec(source);
  return pstack?.[1];
}

function frontmatterEntries(frontmatter) {
  const entries = [];
  for (const line of frontmatter.split('\n')) {
    const key = /^([A-Za-z0-9_-]+):/.exec(line)?.[1];
    if (key) entries.push({ key, lines: [line] });
    else if (entries.length > 0) entries.at(-1).lines.push(line);
    else throw new Error(`frontmatter starts with a non-key line: ${line}`);
  }
  return entries;
}

function asMetadata(entry, key) {
  const [first, ...rest] = entry.lines;
  return [`  cursor-${key}:${first.slice(entry.key.length + 1)}`, ...rest.map((line) => `  ${line}`)];
}

/** Renames the skill to its directory and moves non-Agent-Skills fields under metadata, keeping value text. */
export function normalizeFrontmatter(text, directoryName) {
  const match = /^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/.exec(text);
  if (!match) throw new Error(`SKILL.md for ${directoryName} has no frontmatter block`);
  const sourceFrontmatter = match[1];
  const kept = [];
  const moved = [];
  for (const entry of frontmatterEntries(sourceFrontmatter)) {
    if (entry.key === 'name') {
      const original = entry.lines[0].slice('name:'.length).trim();
      kept.push(`name: ${directoryName}`);
      if (original !== directoryName) moved.push(`  cursor-name: ${original}`);
    } else if (STANDARD_FIELDS.has(entry.key)) kept.push(...entry.lines);
    else moved.push(...asMetadata(entry, entry.key));
  }
  if (moved.length > 0 && kept.some((line) => line.startsWith('metadata:'))) throw new Error(`${directoryName} already declares metadata`);
  const frontmatter = moved.length > 0 ? [...kept, 'metadata:', ...moved] : kept;
  return { text: `---\n${frontmatter.join('\n')}\n---${match[2] ?? ''}`, sourceFrontmatter };
}

export function applyPatch(text, patch) {
  return patch.edits.reduce((current, edit) => {
    const count = current.split(edit.before).length - 1;
    if (count !== 1) throw new Error(`patch ${patch.id} expected one match, found ${count}`);
    return current.replace(edit.before, edit.after);
  }, text);
}

function git(checkout, args, encoding) {
  return execFileSync('git', ['-C', checkout, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 });
}

function sourceEntries(checkout) {
  const listing = git(checkout, ['ls-tree', '-r', SOURCE.commit, '--', 'pstack', 'cursor-team-kit'], 'utf8');
  return listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { mode: meta.split(' ')[0], source: path };
    })
    .filter((entry) => !entry.source.endsWith('.DS_Store') && targetFor(entry.source) !== undefined);
}

function assertVersions(checkout) {
  const pstack = JSON.parse(git(checkout, ['show', `${SOURCE.commit}:pstack/.cursor-plugin/plugin.json`], 'utf8'));
  const teamKit = JSON.parse(git(checkout, ['show', `${SOURCE.commit}:cursor-team-kit/.cursor-plugin/plugin.json`], 'utf8'));
  if (pstack.version !== SOURCE.pstackVersion) throw new Error(`pstack is ${pstack.version}, expected ${SOURCE.pstackVersion}`);
  if (teamKit.version !== SOURCE.teamKitVersion) throw new Error(`cursor-team-kit is ${teamKit.version}, expected ${SOURCE.teamKitVersion}`);
}

function transformEntry(entry, bytes) {
  const target = targetFor(entry.source);
  const patch = PATCHES.find((candidate) => candidate.source === entry.source);
  if (patch) return { target, bytes: Buffer.from(applyPatch(bytes.toString('utf8'), patch)), transform: `patch:${patch.id}` };
  const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(target);
  if (!skill) return { target, bytes, transform: 'none' };
  const normalized = normalizeFrontmatter(bytes.toString('utf8'), skill[1]);
  return { target, bytes: Buffer.from(normalized.text), transform: 'frontmatter', sourceFrontmatter: normalized.sourceFrontmatter };
}

export function buildPlan(checkout) {
  git(checkout, ['cat-file', '-e', `${SOURCE.commit}^{commit}`]);
  assertVersions(checkout);
  return sourceEntries(checkout).map((entry) => {
    const bytes = git(checkout, ['show', `${SOURCE.commit}:${entry.source}`], 'buffer');
    const result = transformEntry(entry, bytes);
    return { ...result, source: entry.source, mode: entry.mode, sourceSha256: sha256(bytes), targetSha256: sha256(result.bytes) };
  });
}

export function lockFor(plan) {
  const files = plan
    .map(({ bytes: _bytes, ...file }) => file)
    .toSorted((left, right) => left.target.localeCompare(right.target))
    .map((file) => ({
      source: file.source,
      target: file.target,
      transform: file.transform,
      mode: file.mode,
      sourceSha256: file.sourceSha256,
      targetSha256: file.targetSha256,
      ...(file.sourceFrontmatter === undefined ? {} : { sourceFrontmatter: file.sourceFrontmatter }),
    }));
  return `${JSON.stringify({ source: SOURCE, files, authored: AUTHORED }, null, 2)}\n`;
}

function writePlan(plan) {
  const previous = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')).files.map((file) => file.target) : [];
  const current = new Set(plan.map((file) => file.target));
  for (const stale of previous.filter((target) => !current.has(target))) rmSync(join(packageRoot, stale), { force: true });
  for (const file of plan) {
    const path = join(packageRoot, file.target);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
    chmodSync(path, file.mode === '100755' ? 0o755 : 0o644);
  }
  writeFileSync(lockPath, lockFor(plan));
}

function differences(plan) {
  const found = [];
  for (const file of plan) {
    const path = join(packageRoot, file.target);
    if (!existsSync(path)) found.push(`missing ${file.target}`);
    else if (sha256(readFileSync(path)) !== file.targetSha256) found.push(`changed ${file.target}`);
    else if (((statSync(path).mode & 0o111) !== 0) !== (file.mode === '100755')) found.push(`mode ${file.target}`);
  }
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== lockFor(plan)) found.push('upstream.lock.json differs from the regenerated lock');
  return found;
}

function main(argv) {
  const sourceIndex = argv.indexOf('--source');
  const checkout = sourceIndex === -1 ? undefined : argv[sourceIndex + 1];
  if (!checkout) {
    process.stderr.write('usage: sync-upstream.mjs --source <cursor/plugins checkout> [--check]\n');
    return 2;
  }
  const plan = buildPlan(resolve(checkout));
  if (!argv.includes('--check')) {
    writePlan(plan);
    process.stdout.write(`wrote ${plan.length} files from ${SOURCE.commit}\n`);
    return 0;
  }
  const found = differences(plan);
  process.stdout.write(found.length === 0 ? `upstream check passed: ${plan.length} files match ${SOURCE.commit}\n` : `${found.join('\n')}\n`);
  return found.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
