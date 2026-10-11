#!/usr/bin/env node
// Validates a parity ledger and derives the only verdict its evidence allows.
// Usage: node validate-ledger.mjs <ledger.json> [--root <dir>] [--markdown]
// Exit codes: 0 valid, 1 invalid ledger, 2 usage or unreadable input.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['VERIFIED', 'NOT VERIFIED', 'INCONCLUSIVE', 'NOT APPLICABLE'];
const ID_PATTERN = /^[A-Z][A-Z0-9]*-[0-9]{3,}$/;
const TEXT_FIELDS = ['sourceBehavior', 'evidence', 'piMapping'];

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** The acceptance-test file is the part before an optional `::test name` suffix. */
function testFileOf(acceptanceTest) {
  return acceptanceTest.split('::')[0].trim();
}

function insideRoot(root, file) {
  const rel = relative(root, resolve(root, file));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function statusErrors(req, root) {
  const at = `${req.id}`;
  if (req.status === 'VERIFIED') {
    if (!isText(req.acceptanceTest)) return [`${at}: VERIFIED requires acceptanceTest`];
    const file = testFileOf(req.acceptanceTest);
    if (!insideRoot(root, file)) return [`${at}: acceptanceTest path escapes root: ${file}`];
    if (!existsSync(resolve(root, file))) return [`${at}: acceptanceTest file not found: ${file}`];
    return isText(req.gap) ? [`${at}: VERIFIED must not record a gap`] : [];
  }
  if (req.status === 'NOT APPLICABLE') return isText(req.reason) ? [] : [`${at}: NOT APPLICABLE requires reason`];
  return isText(req.gap) ? [] : [`${at}: ${req.status} requires gap`];
}

function requirementErrors(req, index, root) {
  if (req === null || typeof req !== 'object' || Array.isArray(req)) return [`requirements[${index}]: must be an object`];
  if (typeof req.id !== 'string' || !ID_PATTERN.test(req.id)) return [`requirements[${index}]: id must match ${ID_PATTERN}`];
  const missing = TEXT_FIELDS.filter((field) => !isText(req[field])).map((field) => `${req.id}: missing ${field}`);
  if (!STATUSES.includes(req.status)) return [...missing, `${req.id}: status must be one of ${STATUSES.join(', ')}`];
  return [...missing, ...statusErrors(req, root)];
}

function duplicateIdErrors(requirements) {
  const ids = requirements.map((req) => req?.id).filter((id) => typeof id === 'string');
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  return dupes.map((id) => `duplicate id: ${id}`);
}

/** The strongest verdict the statuses permit. NOT APPLICABLE never blocks VERIFIED. */
export function deriveVerdict(requirements) {
  const statuses = requirements.map((req) => req.status);
  if (statuses.includes('NOT VERIFIED')) return 'NOT VERIFIED';
  if (statuses.includes('INCONCLUSIVE')) return 'INCONCLUSIVE';
  return statuses.includes('VERIFIED') ? 'VERIFIED' : 'INCONCLUSIVE';
}

export function countByStatus(requirements) {
  return Object.fromEntries(STATUSES.map((status) => [status, requirements.filter((req) => req.status === status).length]));
}

export function validateLedger(ledger, root) {
  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) return { errors: ['ledger must be a JSON object'] };
  if (!isText(ledger.capability)) return { errors: ['missing capability'] };
  const { requirements } = ledger;
  if (!Array.isArray(requirements) || requirements.length === 0) return { errors: ['requirements must be a non-empty array'] };
  const errors = [...duplicateIdErrors(requirements), ...requirements.flatMap((req, i) => requirementErrors(req, i, root))];
  if (errors.length > 0) return { errors };
  const verdict = deriveVerdict(requirements);
  const verdictErrors = ledger.verdict === verdict ? [] : [`verdict must be "${verdict}" for these statuses, found "${ledger.verdict}"`];
  return { errors: verdictErrors, verdict, counts: countByStatus(requirements) };
}

const cell = (value) => (isText(value) ? value.replaceAll('|', '\\|').replaceAll('\n', ' ') : '');

export function renderMarkdown(ledger) {
  const header = '| Requirement ID | Source behavior | Evidence | Pi-native mapping | Acceptance test | Status | Gap |\n|---|---|---|---|---|---|---|';
  const rows = ledger.requirements.map((req) => [req.id, req.sourceBehavior, req.evidence, req.piMapping, req.acceptanceTest, req.status, req.gap ?? req.reason].map(cell).join(' | '));
  return [header, ...rows.map((row) => `| ${row} |`)].join('\n');
}

function parseArgs(argv) {
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex === -1 ? undefined : argv[rootIndex + 1];
  const positional = argv.filter((arg, i) => !arg.startsWith('--') && (rootIndex === -1 || i !== rootIndex + 1));
  if (positional.length !== 1 || (rootIndex !== -1 && !root)) return undefined;
  return { file: positional[0], root, markdown: argv.includes('--markdown') };
}

export function main(argv, out = process.stdout, err = process.stderr) {
  const args = parseArgs(argv);
  if (!args) {
    err.write('usage: validate-ledger.mjs <ledger.json> [--root <dir>] [--markdown]\n');
    return 2;
  }
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(args.file, 'utf8'));
  } catch (error) {
    err.write(`cannot read ledger ${args.file}: ${error.message}\n`);
    return 2;
  }
  const result = validateLedger(ledger, resolve(args.root ?? dirname(args.file)));
  if (result.errors.length > 0) {
    err.write(`${result.errors.map((line) => `error: ${line}`).join('\n')}\n`);
    return 1;
  }
  out.write(args.markdown ? `${renderMarkdown(ledger)}\n` : `${JSON.stringify({ verdict: result.verdict, counts: result.counts })}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
