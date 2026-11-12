#!/usr/bin/env node
// Rejects every Biome diagnostic the checked-in baseline does not already hold, so legacy findings stay put and none are added.
//   node scripts/lint-baseline.mjs --check [--biome <path>]
//   node scripts/lint-baseline.mjs --update [--biome <path>]
// A diagnostic is identified by file, rule category, message, and the normalized source text it flags, never by line number, so edits
// elsewhere in a file do not move it. Identical diagnostics are counted. A new finding fails even when an old one was fixed in the same
// change, because the comparison is per identity and never a total.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPE = 'extensions/pi-pstack';
export const BASELINE = `${SCOPE}/lint-baseline.json`;
const GENERATED = `${SCOPE}/parity-results/`;

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

function flaggedText(source, { start, end }) {
  if (!start || !end || (start.line === end.line && start.column === end.column)) return '';
  const lines = source.split('\n');
  const from = lines.slice(start.line - 1, end.line);
  if (from.length === 0) return '';
  from[from.length - 1] = from[from.length - 1].slice(0, end.column - 1);
  from[0] = from[0].slice(start.column - 1);
  return normalize(from.join('\n'));
}

export function identities(diagnostics, readSource) {
  const counts = new Map();
  for (const d of diagnostics) {
    const file = d.location?.path;
    if (!file || file.startsWith(GENERATED)) continue;
    const text = flaggedText(readSource(file), d.location);
    const key = JSON.stringify([file, d.category, d.message, sha(text)]);
    const entry = counts.get(key) ?? { file, category: d.category, message: d.message, hash: sha(text), preview: text.slice(0, 80), count: 0, at: [] };
    entry.count += 1;
    entry.at.push(`${file}:${d.location.start?.line ?? 0}:${d.location.start?.column ?? 0}`);
    counts.set(key, entry);
  }
  return counts;
}

export function compare(baselineEntries, current) {
  const held = new Map(baselineEntries.map((e) => [JSON.stringify([e.file, e.category, e.message, e.hash]), e.count]));
  const added = [];
  const removed = [];
  for (const [key, entry] of current) {
    const extra = entry.count - (held.get(key) ?? 0);
    if (extra > 0) added.push({ ...entry, extra });
  }
  for (const [key, count] of held) if (count > (current.get(key)?.count ?? 0)) removed.push(key);
  return { added, removed };
}

export function serialize(biomeVersion, current) {
  const diagnostics = [...current.values()].map(({ at: _at, ...entry }) => entry).sort((a, b) => a.file.localeCompare(b.file) || a.category.localeCompare(b.category) || a.message.localeCompare(b.message) || a.hash.localeCompare(b.hash));
  return `${JSON.stringify({ biomeVersion, scope: SCOPE, diagnostics }, null, 2)}\n`;
}

export function runBiome(root, biome) {
  const run = (args) => {
    try {
      return execFileSync(biome, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      if (error.stdout) return error.stdout;
      throw error;
    }
  };
  const version = run(['--version'])
    .trim()
    .replace(/^Version:\s*/, '');
  const out = run(['ci', SCOPE, '--reporter=json', '--max-diagnostics=none', '--colors=off']);
  const report = JSON.parse(out.slice(out.indexOf('{')));
  if (!Array.isArray(report.diagnostics)) throw new Error('lint-baseline: Biome printed no diagnostics array');
  return { version, diagnostics: report.diagnostics };
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--update') ? 'update' : args.includes('--check') ? 'check' : null;
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (!mode) {
    console.error('usage: lint-baseline.mjs --check|--update [--biome <path>] [--root <git root>] [--baseline <file>]');
    process.exit(2);
  }
  const root = resolve(option('--root') ?? execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const baselinePath = resolve(root, option('--baseline') ?? BASELINE);
  const local = join(root, 'node_modules/.bin/biome');
  const biome = option('--biome') ?? (existsSync(local) ? local : 'biome');
  const { version, diagnostics } = runBiome(root, biome);
  const current = identities(diagnostics, (file) => readFileSync(join(root, file), 'utf8'));

  if (mode === 'update') {
    writeFileSync(baselinePath, serialize(version, current));
    console.log(`lint-baseline: wrote ${[...current.values()].reduce((n, e) => n + e.count, 0)} diagnostics (${current.size} identities) from Biome ${version}`);
    return;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (baseline.biomeVersion !== version) {
    console.error(`lint-baseline: baseline was recorded with Biome ${baseline.biomeVersion} but this is ${version}; run --update with the pinned version`);
    process.exit(1);
  }
  const { added, removed } = compare(baseline.diagnostics, current);
  if (removed.length > 0) {
    console.log(`lint-baseline: ${removed.length} baseline diagnostic(s) no longer occur; run --update to ratchet the baseline down`);
    for (const key of removed) console.log(`  ${JSON.parse(key).slice(0, 3).join('  ')}`);
  }
  if (added.length === 0) {
    console.log('lint-baseline: no new diagnostics');
    return;
  }
  console.error(`lint-baseline: ${added.reduce((n, e) => n + e.extra, 0)} diagnostic(s) not in the baseline:`);
  for (const e of added) console.error(`  ${e.at.slice(0, e.extra).join(', ')}  ${e.category}  ${e.message}${e.preview ? `  [${e.preview}]` : ''}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
