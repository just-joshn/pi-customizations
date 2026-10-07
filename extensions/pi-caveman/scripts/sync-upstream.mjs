#!/usr/bin/env node
// Regenerates skills/ and agents/ from a JuliusBrussee/caveman checkout.
// Usage: node scripts/sync-upstream.mjs <path-to-caveman-checkout>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(upstream, 'skills', 'caveman', 'SKILL.md'))) {
  process.stderr.write('usage: sync-upstream.mjs <caveman checkout>\n');
  process.exit(2);
}

const PI_SKILL_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);
const SKIP_FILES = new Set(['README.md', 'CLAUDE.md', 'package.json', 'SECURITY.md']);
const SKIP_DIRS = new Set(['tests', 'scripts', 'agents', 'assets']);
const SKILLS = readdirSync(join(upstream, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(upstream, 'skills', entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();

function sanitizeFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return text;
  const kept = [];
  let keep = true;
  for (const line of match[1].split('\n')) {
    const key = /^([A-Za-z-]+):/.exec(line);
    if (key) keep = PI_SKILL_FIELDS.has(key[1]);
    if (keep) kept.push(line);
  }
  return `---\n${kept.join('\n')}\n---\n${text.slice(match[0].length)}`;
}

function copySkill(name) {
  const from = join(upstream, 'skills', name);
  const to = join(root, 'skills', name);
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() ? SKIP_DIRS.has(entry.name) : SKIP_FILES.has(entry.name)) continue;
    cpSync(join(from, entry.name), join(to, entry.name), { recursive: true });
  }
  const skillPath = join(to, 'SKILL.md');
  writeFileSync(skillPath, sanitizeFrontmatter(readFileSync(skillPath, 'utf8')));
}

rmSync(join(root, 'skills'), { recursive: true, force: true });
rmSync(join(root, 'agents'), { recursive: true, force: true });
for (const name of SKILLS) copySkill(name);

const overrides = join(root, 'overrides', 'skills');
for (const name of existsSync(overrides) ? readdirSync(overrides) : []) {
  cpSync(join(overrides, name), join(root, 'skills', name), { recursive: true });
}

mkdirSync(join(root, 'agents'), { recursive: true });
for (const file of readdirSync(join(upstream, 'agents')).filter((name) => /^cavecrew-.*\.md$/.test(name))) {
  cpSync(join(upstream, 'agents', file), join(root, 'agents', file));
}

const sha = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(join(root, 'UPSTREAM.json'), `${JSON.stringify({ repository: 'https://github.com/JuliusBrussee/caveman', commit: sha, skills: SKILLS }, null, 2)}\n`);
process.stdout.write(`synced ${SKILLS.length} skills and cavecrew agents from ${sha}\n`);
