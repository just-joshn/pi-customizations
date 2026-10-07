#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DEFAULT_SURFACES = join(ROOT, 'docs/user-perspective-testing/surfaces.tsv');
const DEFAULT_ARTIFACTS = join(ROOT, 'artifacts/user-perspective');
const DEFAULT_OUT = join(ROOT, 'docs/user-perspective-testing/verdicts.tsv');
const DEFAULT_FINDINGS = join(ROOT, 'docs/user-perspective-testing/open-findings.md');

const FINDING_STATUSES = new Set(['open', 'fixed', 'out-of-reach']);
const CLOSED_STATUSES = new Set(['fixed', 'out-of-reach']);

const SURFACE_COLUMNS = ['surface_id', 'package', 'kind', 'name', 'trigger', 'expected', 'source', 'tier', 'veto'];
const VERDICT_COLUMNS = ['surface_id', 'package', 'tier', 'scope', 'verdict', 'reason', 'observed', 'evidence', 'head_sha', 'checked_at'];
const VERDICTS = new Set(['verified', 'failed', 'inconclusive', 'env-limited', 'not-drivable']);
const SCOPES = new Set(['discovery', 'behaviour']);
const VERDICT_ORDER = ['verified', 'failed', 'partial', 'inconclusive', 'env-limited', 'not-drivable', 'uncovered'];
const PARTIAL_REASON = "only discovery evidence; the row's claim is behavioural";

function parseArgs(argv) {
  const options = { surfaces: DEFAULT_SURFACES, artifacts: DEFAULT_ARTIFACTS, out: DEFAULT_OUT, findings: DEFAULT_FINDINGS, requireComplete: false };
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
      const surface = { surface_id: cells[0], package: cells[1], tier: cells[7], expected: cells[5] };
      if (seen.has(surface.surface_id)) throw new Error(`${path}: duplicate surface_id ${surface.surface_id}`);
      seen.add(surface.surface_id);
      return surface;
    });
}

function readFindings(path) {
  const findings = [];
  let current = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const heading = /^##\s+(F-\d+)\s*:\s*(.+?)\s*$/.exec(line);
    if (heading) {
      current = { id: heading[1], title: heading[2], status: null };
      findings.push(current);
      continue;
    }
    if (!current || current.status !== null) continue;
    const status = /^\*\*Status\.\*\*\s*(.+?)\s*$/.exec(line);
    if (status) current.status = status[1];
  }
  return findings;
}

function receiptProblem(receipt, claimedId) {
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) return 'receipt is not a JSON object';
  if (receipt.surface_id !== claimedId) return `surface_id ${JSON.stringify(receipt.surface_id)} does not match file name '${claimedId}'`;
  if (!VERDICTS.has(receipt.verdict)) return `invalid verdict ${JSON.stringify(receipt.verdict)}`;
  if (receipt.scope !== undefined && !SCOPES.has(receipt.scope)) return `invalid scope ${JSON.stringify(receipt.scope)}`;
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

// A later receipt must never mask an earlier, stronger one. A discovery drive that only saw a
// command registered used to overwrite a behavioural drive that saw it fail, because the pick was
// by timestamp alone. Failures dominate, then a real positive observation, then the states that
// observed nothing. Timestamp only breaks ties within the same verdict.
const VERDICT_PRECEDENCE = ['failed', 'verified', 'inconclusive', 'env-limited', 'not-drivable'];

function rank(entry) {
  const index = VERDICT_PRECEDENCE.indexOf(entry.receipt.verdict);
  return index === -1 ? VERDICT_PRECEDENCE.length : index;
}

// A receipt that does not declare behaviour scope cannot satisfy a behavioural claim. Legacy
// receipts written before the scope field existed are read as discovery evidence, the weaker
// reading; runs after this contract carry the scope they actually observed.
function receiptScope(entry) {
  return entry.receipt.scope === 'behaviour' ? 'behaviour' : 'discovery';
}

function satisfiesTier(tier, entry) {
  return tier === 'T1' || receiptScope(entry) === 'behaviour';
}

function pickReceipt(entries) {
  const valid = entries.filter((entry) => !entry.problem);
  if (valid.length === 0) return entries[0];
  return valid.reduce((best, entry) => {
    const byRank = rank(entry) - rank(best);
    if (byRank !== 0) return byRank < 0 ? entry : best;
    return timestamp(entry) >= timestamp(best) ? entry : best;
  });
}

function reportConflicts(receipts) {
  let conflicts = 0;
  for (const [surfaceId, entries] of receipts) {
    const verdicts = [...new Set(entries.filter((entry) => !entry.problem).map((entry) => entry.receipt.verdict))];
    if (verdicts.length < 2) continue;
    conflicts += 1;
    const detail = entries
      .filter((entry) => !entry.problem)
      .map((entry) => `${entry.receipt.verdict} from ${entry.receipt.scenario ?? 'unnamed'}`)
      .join(', ');
    console.log(`conflict: ${surfaceId} has ${verdicts.length} verdicts across drives (${detail}); reporting the strongest`);
  }
  return conflicts;
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function displayPath(path) {
  const display = relative(ROOT, path);
  return display.startsWith('..') ? path : display;
}

function staleWarning(surfaceId, picked, head, warnings) {
  const { receipt } = picked;
  if (head && receipt.head_sha && receipt.head_sha !== head) {
    warnings.push(`${surfaceId}: receipt head_sha ${String(receipt.head_sha).slice(0, 12)} differs from HEAD ${head.slice(0, 12)} (${displayPath(picked.path)})`);
  }
}

function rowFromReceipt(base, picked, head, warnings) {
  staleWarning(base.surface_id, picked, head, warnings);
  const { receipt } = picked;
  return {
    ...base,
    scope: stringValue(receipt.scope),
    verdict: receipt.verdict,
    reason: stringValue(receipt.reason),
    observed: receipt.observed,
    evidence: stringValue(receipt.evidence),
    head_sha: stringValue(receipt.head_sha),
    checked_at: stringValue(receipt.checked_at),
  };
}

function buildRows(surfaces, receipts, head, warnings) {
  return surfaces.map((surface) => {
    const entries = receipts.get(surface.surface_id);
    const base = { surface_id: surface.surface_id, package: surface.package, tier: surface.tier };
    if (!entries || entries.length === 0) {
      return { ...base, scope: '', verdict: 'uncovered', reason: 'no receipt was produced for this surface', observed: '', evidence: '', head_sha: '', checked_at: '' };
    }
    // A scenario authors its own expected text, which is the freedom that lets a claim move away
    // from the row without anyone noticing. They are allowed to narrow; the divergence is not
    // allowed to be silent.
    for (const entry of entries) {
      const claimed = stringValue(entry.receipt.expected);
      if (!entry.problem && claimed && claimed !== surface.expected) {
        warnings.push(`${surface.surface_id}: receipt expected text differs from the row (row: ${JSON.stringify(surface.expected)}, receipt: ${JSON.stringify(claimed)})`);
      }
    }
    const valid = entries.filter((entry) => !entry.problem);
    if (valid.length === 0) {
      const picked = entries[0];
      return {
        ...base,
        verdict: 'inconclusive',
        observed: picked.problem,
        evidence: displayPath(picked.path),
        head_sha: stringValue(picked.receipt.head_sha),
        checked_at: stringValue(picked.receipt.checked_at),
      };
    }
    const failed = valid.find((entry) => entry.receipt.verdict === 'failed');
    const satisfying = valid.filter((entry) => satisfiesTier(surface.tier, entry));
    if (!failed && satisfying.length === 0) {
      const only = pickReceipt(valid);
      if (only.receipt.verdict !== 'verified') return rowFromReceipt(base, only, head, warnings);
      staleWarning(surface.surface_id, only, head, warnings);
      return {
        ...base,
        verdict: 'partial',
        reason: PARTIAL_REASON,
        observed: PARTIAL_REASON,
        evidence: stringValue(only.receipt.evidence),
        head_sha: stringValue(only.receipt.head_sha),
        checked_at: stringValue(only.receipt.checked_at),
      };
    }
    return rowFromReceipt(base, failed ?? pickReceipt(satisfying), head, warnings);
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
  for (const row of rows) {
    if (row.verdict === 'partial') console.log(`partial: ${row.surface_id}: ${PARTIAL_REASON}`);
  }
  const conflicts = reportConflicts(receipts);
  if (conflicts > 0) console.log(`warning: ${conflicts} surfaces have conflicting receipts; the strongest verdict is reported`);
  const findings = options.findings && existsSync(options.findings) ? readFindings(options.findings) : [];
  writeVerdicts(options.out, rows);
  printTable(rows);
  const display = displayPath(options.out);
  console.log(`wrote ${display}`);
  if (findings.length > 0) {
    const open = findings.filter((finding) => !CLOSED_STATUSES.has(finding.status ?? ''));
    console.log(`findings: ${findings.length} recorded, ${open.length - findings.filter((finding) => !FINDING_STATUSES.has(finding.status ?? '')).length} fixed or out-of-reach, ${open.length} still open`);
    for (const finding of open) {
      const reason = finding.status === null ? 'no status line' : FINDING_STATUSES.has(finding.status) ? finding.status : `unrecognised status '${finding.status}'`;
      console.log(`  ${finding.id}: ${reason}: ${finding.title}`);
    }
  }
  if (options.requireComplete) {
    const uncovered = rows.filter((row) => row.verdict === 'uncovered').map((row) => row.surface_id);
    const unresolved = findings.filter((finding) => !CLOSED_STATUSES.has(finding.status ?? ''));
    if (uncovered.length > 0) {
      console.log(`INCOMPLETE: ${uncovered.length} uncovered surfaces`);
      for (const surfaceId of uncovered) console.log(surfaceId);
    }
    if (unresolved.length > 0) {
      console.log(`INCOMPLETE: ${unresolved.length} findings are neither fixed nor proven out of reach`);
      for (const finding of unresolved) console.log(`${finding.id}: ${finding.title}`);
    }
    if (uncovered.length > 0 || unresolved.length > 0) {
      process.exitCode = 1;
    } else {
      console.log('complete: every surface has a receipt and every finding is fixed or proven out of reach');
    }
  }
} catch (error) {
  console.error(`coverage-report: ${error.message}`);
  process.exitCode = 1;
}
