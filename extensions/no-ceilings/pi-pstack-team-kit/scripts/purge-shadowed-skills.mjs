#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageSkillsDir = join(packageRoot, 'skills');
const apply = process.argv.includes('--apply');

function resolveAgentDir() {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
}

function packageSkillNames() {
  return readdirSync(packageSkillsDir)
    .filter((name) => existsSync(join(packageSkillsDir, name, 'SKILL.md')))
    .toSorted();
}

function candidateRoots() {
  const cwd = process.cwd();
  return [
    { label: 'user-pi', dir: join(resolveAgentDir(), 'skills') },
    { label: 'project-pi', dir: join(cwd, '.pi', 'skills') },
    { label: 'user-agents', dir: join(homedir(), '.agents', 'skills') },
    { label: 'project-agents', dir: join(cwd, '.agents', 'skills') },
  ];
}

function archive(root, name, backupRoot) {
  const source = join(root.dir, name);
  const destination = join(backupRoot, root.label, name);
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(source, destination);
  return destination;
}

const names = packageSkillNames();
const roots = candidateRoots();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = join(resolveAgentDir(), 'backups', `pstack-team-kit-shadows-${stamp}`);
const matches = [];

for (const root of roots) {
  if (!existsSync(root.dir) || !statSync(root.dir).isDirectory()) {
    continue;
  }
  if (resolve(root.dir) === resolve(packageSkillsDir)) {
    continue;
  }
  for (const name of names) {
    const localFile = join(root.dir, name, 'SKILL.md');
    if (!existsSync(localFile)) {
      continue;
    }
    const packageFile = join(packageSkillsDir, name, 'SKILL.md');
    const localSame = readFileSync(localFile, 'utf8') === readFileSync(packageFile, 'utf8');
    matches.push({ root, name, kind: localSame ? 'identical' : 'stale or edited' });
  }
}

if (matches.length === 0) {
  console.info('No shadowing copies found. Pi will load the package skills.');
} else {
  for (const match of matches) {
    const source = join(match.root.dir, match.name);
    if (apply) {
      const destination = archive(match.root, match.name, backupRoot);
      console.info(`archived ${source} -> ${destination} (${match.kind})`);
    } else {
      console.info(`would archive ${source} (${match.kind})`);
    }
  }

  if (apply) {
    console.info(`\nArchived ${matches.length} copies under ${backupRoot}. Run /reload, then the package skills win.`);
  } else {
    console.info(`\n${matches.length} copies shadow the package. Re-run with --apply to archive them under ${backupRoot}.`);
  }
}
