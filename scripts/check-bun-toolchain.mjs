#!/usr/bin/env node
// The repository is a Bun workspace. A second lockfile changes which linker Bun
// picks on a fresh install, and npm in a package script, a Makefile recipe, a
// documented command, or a spawned process reverts the toolchain quietly. Both
// fail here instead of surfacing later as a resolution or gate difference.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FOREIGN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const FOREIGN_COMMAND = /\b(?:npm|npx|yarn|pnpm)\b/;
const FOREIGN_COMMAND_LINE = /^(?:npm|npx|yarn|pnpm)(?:\s|$)/;
const FOREIGN_LAUNCH = /\b(?:execFileSync|execFile|execSync|exec|spawnSync|spawn)\s*\(\s*['"](?:npm|npx|yarn|pnpm)['"]/;
const SKIP_SEGMENTS = new Set(['node_modules', 'coverage', 'dist', '.git', '.audit', 'upstream', 'upstream-team-kit', 'skills']);
// Generated from the pinned snapshots, where the checker rejects any edit.
const SKIP_PREFIXES = ['extensions/pi-pstack/prompts'];
// Dated records keep the commands a past run actually executed.
const RECORD_FILES = new Set(['extensions/pi-pstack/docs/team-kit-runtime-review.md']);
// A detector's own fixtures have to contain what it detects.
const SKIP_FILES = new Set(['scripts/check-bun-toolchain.selftest.mjs']);

function walk(root, directory = root, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path);
    if (SKIP_SEGMENTS.has(entry.name) || SKIP_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) continue;
    if (entry.isDirectory()) walk(root, path, found);
    else found.push(relativePath);
  }
  return found;
}

function fencedCommands(source) {
  const commands = [];
  let inFence = false;
  for (const line of source.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && FOREIGN_COMMAND_LINE.test(line.trim())) commands.push(line.trim());
  }
  return commands;
}

function recipes(source) {
  return source.split('\n').filter((line) => line.startsWith('\t'));
}

export function toolchainViolations(root) {
  const violations = [];
  const files = walk(root);
  const report = (path, message) => violations.push(`${path}: ${message}`);

  const lockfiles = files.filter((path) => path.endsWith('bun.lock'));
  if (!lockfiles.includes('bun.lock')) report('bun.lock', 'the workspace root needs one Bun lockfile');
  for (const path of files.filter((path) => FOREIGN_LOCKFILES.includes(path.split('/').at(-1)))) {
    report(path, 'a second package manager lockfile silences the Bun workspace');
  }

  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!Array.isArray(rootManifest.workspaces) || !rootManifest.workspaces.includes('extensions/*')) {
    report('package.json', 'the root manifest must declare the extensions/* workspace');
  }

  for (const path of files) {
    if (['package.json', 'Makefile'].includes(path.split('/').at(-1))) {
      const source = readFileSync(join(root, path), 'utf8');
      const lines = path.endsWith('package.json') ? Object.entries(JSON.parse(source).scripts ?? {}).map(([name, body]) => `${name}: ${body}`) : recipes(source);
      for (const line of lines) if (FOREIGN_COMMAND.test(line)) report(path, `runs another package manager: ${line.trim()}`);
      continue;
    }
    if (path.endsWith('.md')) {
      if (RECORD_FILES.has(path)) continue;
      for (const command of fencedCommands(readFileSync(join(root, path), 'utf8'))) {
        report(path, `documents another package manager: ${command}`);
      }
      continue;
    }
    if (/\.(?:mjs|ts)$/.test(path) && !path.endsWith('.d.ts') && !SKIP_FILES.has(path)) {
      const source = readFileSync(join(root, path), 'utf8');
      if (FOREIGN_LAUNCH.test(source)) report(path, 'launches another package manager');
    }
  }

  return { violations, counts: { lockfiles: lockfiles.length, files: files.length } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { violations, counts } = toolchainViolations(root);
  if (violations.length) {
    process.stderr.write(`${violations.join('\n')}\n${violations.length} Bun toolchain violations.\n`);
    process.exit(1);
  }
  process.stdout.write(`Bun toolchain: ${counts.lockfiles} lockfile, ${counts.files} files, 0 foreign package managers.\n`);
}
