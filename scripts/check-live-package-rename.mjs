import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const needles = ['pi-xai-oauth', 'verify-xai-oauth-live'];
const checker = 'scripts/check-live-package-rename.mjs';
const planMaySpellOldPackage = new Set(['docs/plans/pi-x-subscription-oauth.md']);
const notesMaySpellOldPackage = 'extensions/pi-x-subscription-oauth/test/fixtures/grok-1.0.50-authorize-url.json';
const skipDirNames = new Set(['.git', 'node_modules', 'coverage']);

function notesOnly(text, needle) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.notes !== 'string') return false;
  const { notes, ...rest } = parsed;
  return !JSON.stringify(rest).includes(needle) && notes.includes(needle);
}

function pathHits(dir, rel = '') {
  const hits = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipDirNames.has(entry.name)) continue;
    if (rel === '' && entry.name === 'parity') continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const matched = needles.find((needle) => childRel.includes(needle));
    if (matched) hits.push(`${childRel}: path contains ${matched}`);
    if (entry.isDirectory() && !matched) hits.push(...pathHits(join(dir, entry.name), childRel));
  }
  return hits;
}

const hits = pathHits(root);

let listed = '';
try {
  listed = execFileSync('rg', ['-l', '--hidden', '-g', '!.git/**', '-g', '!node_modules/**', '-g', '!coverage/**', '-g', '!parity/**', '-e', needles[0], '-e', needles[1], '.'], {
    cwd: root,
    encoding: 'utf8',
  });
} catch (error) {
  if (error.status !== 1) throw error;
}

for (const rel of listed
  .split('\n')
  .filter(Boolean)
  .map((line) => line.replace(/^\.\//, ''))) {
  if (rel === checker || planMaySpellOldPackage.has(rel)) continue;
  const text = readFileSync(join(root, rel), 'utf8');
  for (const needle of needles) {
    if (rel === notesMaySpellOldPackage && notesOnly(text, needle)) continue;
    for (const [index, line] of text.split('\n').entries()) {
      if (line.includes(needle)) hits.push(`${rel}:${index + 1}:${line.trim()}`);
    }
  }
}

if (hits.length === 0) {
  process.stdout.write(`no live ${needles.join(' or ')} hits\n`);
  process.exit(0);
}

process.stderr.write(`${hits.length} live hit(s)\n${hits.join('\n')}\n`);
process.exit(1);
