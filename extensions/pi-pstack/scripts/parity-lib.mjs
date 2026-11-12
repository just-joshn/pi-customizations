// Shared by build-parity-manifest.mjs, check-release.mjs and check-parity.mjs. Pure functions over files and a vitest JSON report.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

export const STATUS = { PASS: 'PASS', FAIL: 'FAIL', INCONCLUSIVE: 'INCONCLUSIVE', NA: 'N/A' };
const MAX_SPAN_LINES = 60;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

export function loadInputs(root) {
  const requirementsText = readFileSync(join(root, 'requirements/requirements.json'), 'utf8');
  const lock = readJson(root, 'generated/upstream-lock.json');
  return { requirementsText, requirements: JSON.parse(requirementsText), lock, dependencies: readJson(root, 'generated/dependency-manifest.json') };
}

export const requirementsDigest = ({ requirementsText, lock }) => sha256(`${requirementsText}\n${lock.revision}\n${JSON.stringify(lock.files)}`);

function originOf(path) {
  if (path.startsWith('vendor/upstream-pstack/')) return ['pstack', path.slice('vendor/upstream-pstack/'.length)];
  if (path.startsWith('vendor/upstream-cursor-team-kit/')) return ['team-kit', path.slice('vendor/upstream-cursor-team-kit/'.length)];
  return [null, path];
}

function fileFacts(root, path) {
  const buffer = readFileSync(join(root, path));
  const text = !buffer.includes(0);
  return { file: path, sha256: sha256(buffer), ...(text ? { lines: [1, Math.max(1, buffer.toString('utf8').replace(/\n$/, '').split('\n').length)] } : { bytes: buffer.length }) };
}

function names(root, lock, dependencies) {
  const playbooks = Object.keys(lock.files)
    .map((f) => /^vendor\/upstream-pstack\/skills\/poteto-mode\/playbooks\/([^/]+)\.md$/.exec(f)?.[1])
    .filter(Boolean);
  const skills = dependencies.skills.filter((s) => s.required).map((s) => s.name);
  return { playbooks, skills };
}

function expandTests(ids, catalog, bound, lists, problems, owner) {
  const out = [];
  for (const id of ids) {
    const entry = catalog[id];
    if (!entry) {
      problems.push(`${owner}: test "${id}" is not in the requirements test catalog`);
      continue;
    }
    const variants = entry.expand ? lists[entry.expand] : [bound];
    if (entry.name.includes('{name}') && variants.some((v) => v == null)) {
      problems.push(`${owner}: test "${id}" needs a bound name but its record binds none`);
      continue;
    }
    for (const v of variants) out.push({ file: entry.file, name: entry.name.replaceAll('{name}', v ?? '') });
  }
  return out;
}

function checkTestFiles(root, tests, problems, owner) {
  for (const t of tests) if (!existsSync(join(root, t.file))) problems.push(`${owner}: linked test file ${t.file} does not exist`);
}

function bindName(path, bind) {
  if (bind === 'skill') return /^skills\/([^/]+)\//.exec(path)?.[1];
  if (bind === 'playbook') return /playbooks\/([^/]+)\.md$/.exec(path)?.[1];
  return undefined;
}

/** Builds the source-backed records and validates them. Returns { records, problems }. */
export function buildRecords(root, inputs) {
  const { requirements, lock, dependencies } = inputs;
  const problems = [];
  const lists = names(root, lock, dependencies);
  const catalog = requirements.tests;
  const records = [];
  const requiredTeamKit = new Set(dependencies.requiredTeamKit.map((s) => s.name));

  const rules = requirements.structural.map((rule) => ({ ...rule, re: new RegExp(rule.match), files: [] }));
  for (const path of Object.keys(lock.files).sort()) {
    const [origin, rel] = originOf(path);
    if (!origin) {
      problems.push(`${path}: vendored file outside the two upstream roots`);
      continue;
    }
    const key = `${origin}:${rel}`;
    const rule = rules.find((r) => r.re.test(key) && (!r.teamKit || (r.teamKit === 'required') === requiredTeamKit.has(/^skills\/([^/]+)\//.exec(rel)?.[1])));
    if (!rule) {
      problems.push(`${path}: upstream file has no requirement record; add a structural rule to requirements/requirements.json`);
      continue;
    }
    rule.files.push({ path, rel, origin });
  }
  for (const rule of rules) {
    if (rule.files.length === 0) problems.push(`structural rule ${rule.id}: matches no upstream file (stale rule)`);
    const base = { kind: rule.kind, specSection: rule.specSection, piMechanism: rule.piMechanism, dependencies: rule.dependencies ?? [], prerequisites: rule.prerequisites ?? [], verification: rule.verification, applicability: rule.mandatory === false ? { mandatory: false, justification: rule.naJustification } : { mandatory: true }, ...(rule.coverageGap ? { coverageGap: rule.coverageGap } : {}) };
    if (rule.mandatory === false && !rule.naJustification?.trim()) problems.push(`structural rule ${rule.id}: not applicable without a written justification`);
    if (rule.group) {
      const owner = `SRC-GROUP/${rule.id}`;
      const tests = expandTests(rule.tests ?? [], catalog, undefined, lists, problems, owner);
      checkTestFiles(root, tests, problems, owner);
      records.push({ id: owner, ...base, title: rule.title, source: { files: rule.files.map((f) => fileFacts(root, f.path)) }, observable: rule.observable, invariants: rule.invariants, tests });
      continue;
    }
    for (const f of rule.files) {
      const owner = `SRC/${f.origin}/${f.rel}`;
      const bound = bindName(f.rel, rule.bind);
      const tests = expandTests(rule.tests ?? [], catalog, bound, lists, problems, owner);
      checkTestFiles(root, tests, problems, owner);
      const facts = fileFacts(root, f.path);
      if (facts.sha256 !== lock.files[f.path]) problems.push(`${f.path}: differs from generated/upstream-lock.json`);
      records.push({ id: owner, ...base, title: `${rule.title}: ${f.rel}`, source: facts, observable: rule.observable.replaceAll('{file}', f.rel), invariants: rule.invariants, tests });
    }
  }

  const seen = new Set(records.map((r) => r.id));
  for (const b of requirements.behavioral) {
    const owner = b.id ?? '(record without id)';
    if (!/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(owner)) problems.push(`${owner}: id must be upper-case words joined by hyphens`);
    if (seen.has(owner)) problems.push(`${owner}: duplicate requirement id`);
    seen.add(owner);
    for (const field of ['title', 'specSection', 'observable', 'piMechanism', 'verification']) if (typeof b[field] !== 'string' || !b[field].trim()) problems.push(`${owner}: missing ${field}`);
    for (const field of ['invariants', 'dependencies', 'prerequisites']) if (!Array.isArray(b[field])) problems.push(`${owner}: ${field} must be an array`);
    if (!b.invariants?.length) problems.push(`${owner}: needs at least one invariant`);
    if (b.applicability?.mandatory === false) {
      if (!b.applicability.justification?.trim()) problems.push(`${owner}: not applicable without a written justification`);
    } else if (b.applicability?.mandatory !== true) problems.push(`${owner}: applicability.mandatory must be true or false`);
    problems.push(...checkSource(root, lock, b.source, owner));
    const tests = expandTests(b.tests ?? [], catalog, undefined, lists, problems, owner);
    checkTestFiles(root, tests, problems, owner);
    records.push({
      id: owner, kind: 'behavioral', title: b.title, specSection: b.specSection,
      source: b.source?.specOnly ? { specOnly: true, reason: b.source.reason } : b.source && existsSync(join(root, b.source.file ?? '')) ? spanFacts(root, b.source) : null,
      observable: b.observable, invariants: b.invariants, piMechanism: b.piMechanism, dependencies: b.dependencies, prerequisites: b.prerequisites,
      applicability: b.applicability, verification: b.verification, tests, ...(b.coverageGap ? { coverageGap: b.coverageGap } : {}),
    });
  }
  return { records, problems };
}

function spanFacts(root, source) {
  const lines = readFileSync(join(root, source.file), 'utf8').split('\n');
  const [a, b] = source.lines;
  return { file: source.file, lines: [a, b], sha256: sha256(lines.slice(a - 1, b).join('\n')) };
}

/** A span must resolve to real lines of a locked vendored file and contain its anchor. */
export function checkSource(root, lock, source, owner) {
  if (!source) return [`${owner}: no source; cite an upstream span or mark it specOnly with a reason`];
  if (source.specOnly) return source.reason?.trim() ? [] : [`${owner}: specOnly source needs a written reason`];
  const problems = [];
  const { file, lines, anchor } = source;
  if (!(file in lock.files)) return [`${owner}: source ${file} is not a locked upstream file`];
  if (!Array.isArray(lines) || lines.length !== 2 || !Number.isInteger(lines[0]) || !Number.isInteger(lines[1]) || lines[0] < 1 || lines[1] < lines[0]) return [`${owner}: source lines for ${file} must be [first, last] with 1 <= first <= last`];
  const buffer = readFileSync(join(root, file));
  if (buffer.includes(0)) return [`${owner}: ${file} is binary, so it has no line span`];
  const content = buffer.toString('utf8').replace(/\n$/, '').split('\n');
  if (lines[1] > content.length) return [`${owner}: source span ${file}:${lines[0]}-${lines[1]} is past the end of the file (${content.length} lines)`];
  if (lines[1] - lines[0] + 1 > MAX_SPAN_LINES) problems.push(`${owner}: span ${file}:${lines[0]}-${lines[1]} is longer than ${MAX_SPAN_LINES} lines; cite the lines it derives from`);
  if (typeof anchor !== 'string' || !anchor.trim()) problems.push(`${owner}: source needs an anchor, a phrase that appears in the span`);
  else if (!content.slice(lines[0] - 1, lines[1]).join('\n').includes(anchor)) problems.push(`${owner}: anchor "${anchor}" is not in ${file}:${lines[0]}-${lines[1]}`);
  return problems;
}

const key = (file, name) => `${file}::${name}`;

export function indexResults(report, root) {
  const byTest = new Map();
  const failedFiles = new Set();
  for (const suite of report.testResults ?? []) {
    const file = isAbsolute(suite.name) ? relative(root, suite.name).split('\\').join('/') : suite.name;
    if (suite.status === 'failed' && !(suite.assertionResults ?? []).length) failedFiles.add(file);
    for (const a of suite.assertionResults ?? []) {
      const k = key(file, a.fullName);
      byTest.set(k, [...(byTest.get(k) ?? []), a.status]);
    }
  }
  return { byTest, failedFiles };
}

function outcomeOf(statuses, fileFailed) {
  if (!statuses) return fileFailed ? 'failed-to-run' : 'missing';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.every((s) => s === 'passed')) return 'passed';
  return statuses.find((s) => s !== 'passed');
}

/** FAIL beats INCONCLUSIVE beats PASS. Only a linked test that ran and passed counts toward PASS. */
export function deriveStatus(record, outcomes) {
  if (record.applicability.mandatory === false) return { status: STATUS.NA, reason: record.applicability.justification };
  const bad = outcomes.filter((o) => o.outcome === 'failed' || o.outcome === 'failed-to-run');
  if (bad.length) return { status: STATUS.FAIL, reason: `${bad.length} linked test(s) failed: ${bad.map((o) => o.name).join('; ')}` };
  if (outcomes.length === 0) return { status: STATUS.INCONCLUSIVE, reason: 'no test is linked' };
  const notPassed = outcomes.filter((o) => o.outcome !== 'passed');
  if (notPassed.length) return { status: STATUS.INCONCLUSIVE, reason: notPassed.map((o) => `${o.outcome}: ${o.file}::${o.name}`).join('; ') };
  if (record.coverageGap) return { status: STATUS.INCONCLUSIVE, reason: `declared coverage gap: ${record.coverageGap}` };
  return { status: STATUS.PASS, reason: `${outcomes.length} linked test(s) ran and passed` };
}

export function evaluate(records, report, root) {
  const { byTest, failedFiles } = indexResults(report, root);
  return records.map((record) => {
    const results = record.tests.map((t) => ({ file: t.file, name: t.name, outcome: outcomeOf(byTest.get(key(t.file, t.name)), failedFiles.has(t.file)) }));
    return { ...record, results, ...deriveStatus(record, results) };
  });
}

export function runIdentity(root, report, resultsSource) {
  const git = (...args) => { try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); } catch { return null; } };
  return {
    startedAt: report.startTime ? new Date(report.startTime).toISOString() : null,
    generatedAt: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD'),
    dirty: Boolean(git('status', '--porcelain', '--', '.')),
    resultsSource,
    totalTests: report.numTotalTests ?? null,
    passedTests: report.numPassedTests ?? null,
    failedTests: report.numFailedTests ?? null,
    skippedTests: report.numPendingTests ?? null,
  };
}

export function tally(evaluated) {
  const counts = {};
  for (const r of evaluated) {
    const kind = r.kind === 'behavioral' ? 'behavioral' : 'structural';
    counts[kind] ??= { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, 'N/A': 0 };
    counts[kind][r.status]++;
  }
  return counts;
}

export const sourceLabel = (r) => (r.source?.file ? `${r.source.file}${r.source.lines ? `:${r.source.lines[0]}-${r.source.lines[1]}` : ''}` : r.source?.files ? `${r.source.files.length} files under ${r.source.files[0].file.split('/').slice(0, 4).join('/')}` : r.source?.specOnly ? `specification ${r.specSection}` : 'no source');

export const MARKERS = ['<!-- parity-status:begin (generated by scripts/build-parity-manifest.mjs; do not edit) -->', '<!-- parity-status:end -->'];

export function renderStatusSection(manifest) {
  const { evaluated: rows, run, counts } = { evaluated: manifest.requirements, run: manifest.run, counts: manifest.counts };
  const cell = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [MARKERS[0], '', `Computed from a Vitest run of commit \`${run.commit?.slice(0, 12) ?? 'unknown'}\`${run.dirty ? ' (dirty tree)' : ''} at ${run.generatedAt}, by \`node scripts/build-parity-manifest.mjs\`. A requirement is PASS only when every linked test ran and passed. A skipped, missing, or unlinked test is INCONCLUSIVE. \`node scripts/check-release.mjs\` exits non-zero until every mandatory requirement is PASS.`, '', '| Kind | PASS | FAIL | INCONCLUSIVE | N/A |', '| --- | --- | --- | --- | --- |'];
  for (const [kind, c] of Object.entries(counts)) lines.push(`| ${kind} | ${c.PASS} | ${c.FAIL} | ${c.INCONCLUSIVE} | ${c['N/A']} |`);
  lines.push('', '### Behavioral requirements', '', '| Requirement | Spec | Status | Upstream source | Why not PASS |', '| --- | --- | --- | --- | --- |');
  for (const r of rows.filter((x) => x.kind === 'behavioral')) lines.push(`| \`${r.id}\` ${cell(r.title)} | ${r.specSection} | ${r.status} | ${cell(sourceLabel(r))} | ${r.status === 'PASS' || r.status === 'N/A' ? '' : cell(r.reason)} |`);
  const open = rows.filter((x) => x.kind !== 'behavioral' && x.status !== 'PASS' && x.status !== 'N/A');
  lines.push('', '### Structural requirements that are not PASS', '');
  if (open.length === 0) lines.push('None.');
  else {
    lines.push('| Requirement | Status | Why |', '| --- | --- | --- |');
    for (const r of open) lines.push(`| \`${r.id}\` | ${r.status} | ${cell(r.reason)} |`);
  }
  lines.push('', MARKERS[1]);
  return lines.join('\n');
}

export function spliceStatusSection(doc, section) {
  const [begin, end] = MARKERS;
  const a = doc.indexOf(begin.slice(0, 24));
  const b = doc.indexOf(end);
  if (a < 0 || b < 0) throw new Error('docs/parity-status.md has no parity-status markers');
  return `${doc.slice(0, a)}${section}${doc.slice(b + end.length)}`;
}
