#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const revision = '5866df557357d005b3c0c9d3da0d9e739b4bdde3';
const repository = 'https://github.com/cursor/plugins.git';
const temp = mkdtempSync(join(tmpdir(), 'pstack-upstream-'));
try {
  execFileSync('git', ['init', '-q', temp]);
  execFileSync('git', ['-C', temp, 'fetch', '-q', '--depth=1', repository, revision], { stdio: 'inherit' });
  execFileSync('git', ['-C', temp, 'checkout', '-q', '--detach', revision]);
  const sources = [
    ['pstack', 'vendor/upstream-pstack', ['skills', 'agents', 'automations', 'docs', 'assets', '.cursor-plugin', 'plugin.json', 'README.md', 'LICENSE']],
    ['cursor-team-kit', 'vendor/upstream-cursor-team-kit', ['skills']],
  ];
  for (const [source, destination, entries] of sources) {
    const target = join(root, destination);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const entry of entries) cpSync(join(temp, source, entry), join(target, entry), { recursive: true, preserveTimestamps: false });
  }
  const files = {};
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[relative(root, path).split('\\').join('/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
      else throw new Error(`Unsupported upstream entry: ${path}`);
    }
  }
  for (const [, destination] of sources) visit(join(root, destination));
  const counts = {
    files: Object.keys(files).length,
    pstackSkills: readdirSync(join(root, 'vendor/upstream-pstack/skills'), { withFileTypes: true }).filter(e => e.isDirectory()).length,
    teamKitSkills: readdirSync(join(root, 'vendor/upstream-cursor-team-kit/skills'), { withFileTypes: true }).filter(e => e.isDirectory()).length,
  };
  mkdirSync(join(root, 'generated'), { recursive: true });
  writeFileSync(join(root, 'generated/upstream-lock.json'), `${JSON.stringify({ repository, revision, counts, files }, null, 2)}\n`);
  console.log(`Synced ${counts.files} files at ${revision}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
