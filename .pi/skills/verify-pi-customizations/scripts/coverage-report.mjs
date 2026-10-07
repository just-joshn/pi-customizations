#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DEFAULT_SURFACES = join(ROOT, 'docs/user-perspective-testing/surfaces.tsv');
const DEFAULT_ARTIFACTS = join(ROOT, 'artifacts/user-perspective');
const DEFAULT_OUT = join(ROOT, 'docs/user-perspective-testing/verdicts.tsv');

const SURFACE_COLUMNS = ['surface_id', 'package', 'kind', 'name', 'trigger', 'expected', 'source', 'tier', 'veto'];
const VERDICT_COLUMNS = ['surface_id', 'package', 'tier', 'verdict', 'observed', 'evidence', 'head_sha', 'checked_at'];
const VERDICTS = new Set(['verified', 'failed', 'inconclusive', 'env-limited', 'not-drivable']);
const VERDICT_ORDER = ['verified', 'failed', 'inconclusive', 'env-limited', 'not-drivable', 'uncovered'];

function parseArgs(argv) {
  const options = { surfaces: DEFAULT_SURFACES, artifacts: DEFAULT_ARTIFACTS, out: DEFAULT_OUT, requireComplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-complete') {
      options.requireComplete = true;
      continue;
    }
    if (arg !== '--surfaces' && arg !== '--artifacts' && arg !== '--out') {
      throw new Error(`unknown argument '${arg}'\nusage: coverage-report.mjs [--surfaces <surfaces.tsv>] [--artifacts <dir>] [--out <verdicts.tsv>] [--require-complete]`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a path`);
    options[arg.slice(2)] = resolve(value);
    index += 1;
  }
  return options;
}

function readSurfaces(path) {
  const lines = readFileSync(path, 'utf8').replace(/\n$/, '').split('\n');
  const header = lines.shift();
  if (header !== SURFACE_COLUMNS.join('\t')) throw new Error(`${path}: unexpected header: ${JSON.stringify(header)}`);
  const seen = new Set();
  return lines
    .filter((line) => line !== '')
    .map((line) => {
      const cells = line.split('\t');
      if (cells.length !== SURFACE_COLUMNS.length) throw new Error(`${path}: row has ${cells.length} cells: ${line}`);
      const surface = { surface_id: cells[0], package: cells[1], tier: cells[7] };
      if (seen.has(surface.surface_id)) throw new Error(`${path}: duplicate surface_id ${surface.surface_id}`);
      seen.add(surface.surface_id);
      return surface;
    });
}

function receiptProblem(receipt, claimedId) {
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) return 'receipt is not a JSON object';
  if (receipt.surface_id !== claimedId) return `surface_id ${JSON.stringify(receipt.surface_id)} does not match file name '${claimedId}'`;
  if (!VERDICTS.has(receipt.verdict)) return `invalid verdict ${JSON.stringify(receipt.verdict)}`;
  if (typeof receipt.observed !== 'string' || receipt.observed.trim() === '') return 'observed is empty';
  if (receipt.verdict !== 'verified' && (typeof receipt.reason !== 'string' || receipt.reason.trim() === '')) {
    return `verdict '${receipt.verdict}' needs a reason`;
  }
  return null;
}

function loadReceipts(root) {
  const receipts = new Map();
  const malformed = [];
  if (!existsSync(root)) return { receipts, malformed };
  const scenarios = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const scenario of scenarios) {
    const dir = join(root, scenario);
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    for (const file of files) {
      const path = join(dir, file);
      const claimedId = file.slice(0, -'.json'.length);
      let receipt = {};
      let problem = null;
      try {
        receipt = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        problem = `cannot parse JSON: ${error.message}`;
      }
      if (!problem) problem = receiptProblem(receipt, claimedId);
      if (problem) malformed.push({ surface_id: claimedId, path, problem });
      const entries = receipts.get(claimedId) ?? [];
      entries.push({ path, receipt, problem });
      receipts.set(claimedId, entries);
    }
  }
  return { receipts, malformed };
}

function timestamp(entry) {
  const value = Date.parse(entry.receipt.checked_at ?? '');
  return Number.isNaN(value) ? 0 : value;
}

function pickReceipt(entries) {
  const valid = entries.filter((entry) => !entry.problem);
  if (valid.length === 0) return entries[0];
  return valid.reduce((best, entry) => (timestamp(entry) >= timestamp(best) ? entry : best));
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function displayPath(path) {
  const display = relative(ROOT, path);
  return display.startsWith('..') ? path : display;
}

function buildRows(surfaces, receipts, head, warnings) {
  return surfaces.map((surface) => {
    const entries = receipts.get(surface.surface_id);
    const base = { surface_id: surface.surface_id, package: surface.package, tier: surface.tier };
    if (!entries || entries.length === 0) {
      return { ...base, verdict: 'uncovered', observed: '', evidence: '', head_sha: '', checked_at: '' };
    }
    const picked = pickReceipt(entries);
    if (picked.problem) {
      return {
        ...base,
        verdict: 'inconclusive',
        observed: picked.problem,
        evidence: displayPath(picked.path),
        head_sha: stringValue(picked.receipt.head_sha),
        checked_at: stringValue(picked.receipt.checked_at),
      };
    }
    const { receipt } = picked;
    if (head && receipt.head_sha && receipt.head_sha !== head) {
      warnings.push(`${surface.surface_id}: receipt head_sha ${String(receipt.head_sha).slice(0, 12)} differs from HEAD ${head.slice(0, 12)} (${displayPath(picked.path)})`);
    }
    return {
      ...base,
      verdict: receipt.verdict,
      observed: receipt.observed,
      evidence: stringValue(receipt.evidence),
      head_sha: stringValue(receipt.head_sha),
      checked_at: stringValue(receipt.checked_at),
    };
  });
}

function sanitize(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ');
}

function writeVerdicts(path, rows) {
  const lines = [VERDICT_COLUMNS.join('\t')];
  for (const row of rows) lines.push(VERDICT_COLUMNS.map((column) => sanitize(row[column])).join('\t'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
}

function printTable(rows) {
  const packages = [];
  for (const row of rows) {
    if (!packages.includes(row.package)) packages.push(row.package);
  }
  const width = Math.max(...packages.map((name) => name.length), 'TOTAL'.length);
  console.log(['package'.padEnd(width), ...VERDICT_ORDER.map((verdict) => verdict.padStart(13)), 'total'.padStart(13)].join(''));
  for (const pkg of packages) {
    const subset = rows.filter((row) => row.package === pkg);
    console.log(lineFor(pkg, subset, width));
  }
  console.log(lineFor('TOTAL', rows, width));
}

function lineFor(label, subset, width) {
  const counts = VERDICT_ORDER.map((verdict) => subset.filter((row) => row.verdict === verdict).length);
  return [label.padEnd(width), ...counts.map((count) => String(count).padStart(13)), String(subset.length).padStart(13)].join('');
}

try {
  const options = parseArgs(process.argv.slice(2));
  const surfaces = readSurfaces(options.surfaces);
  const { receipts, malformed } = loadReceipts(options.artifacts);
  let head = null;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    console.log('warning: not inside a git work tree; receipt head_sha freshness cannot be checked');
  }
  const known = new Set(surfaces.map((surface) => surface.surface_id));
  for (const entry of malformed) console.log(`malformed receipt: ${displayPath(entry.path)}: ${entry.problem}`);
  const orphans = [...receipts.keys()].filter((surfaceId) => !known.has(surfaceId));
  for (const surfaceId of orphans) console.log(`orphan receipt ignored: ${surfaceId}`);
  const warnings = [];
  const rows = buildRows(surfaces, receipts, head, warnings);
  for (const warning of warnings) console.log(`warning: ${warning}`);
  writeVerdicts(options.out, rows);
  printTable(rows);
  const display = displayPath(options.out);
  console.log(`wrote ${display}`);
  if (options.requireComplete) {
    const uncovered = rows.filter((row) => row.verdict === 'uncovered').map((row) => row.surface_id);
    if (uncovered.length > 0) {
      console.log(`INCOMPLETE: ${uncovered.length} uncovered surfaces`);
      for (const surfaceId of uncovered) console.log(surfaceId);
      process.exitCode = 1;
    } else {
      console.log('complete: every surface has a receipt');
    }
  }
} catch (error) {
  console.error(`coverage-report: ${error.message}`);
  process.exitCode = 1;
}
