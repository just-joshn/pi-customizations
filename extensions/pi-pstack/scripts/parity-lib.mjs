// Shared by build-parity-manifest.mjs, check-release.mjs and check-parity.mjs. Pure functions over files and a vitest JSON report.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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
    const base = {
      kind: rule.kind,
      specSection: rule.specSection,
      piMechanism: rule.piMechanism,
      dependencies: rule.dependencies ?? [],
      prerequisites: rule.prerequisites ?? [],
      verification: rule.verification,
      applicability: rule.mandatory === false ? { mandatory: false, justification: rule.naJustification } : { mandatory: true },
      ...(rule.coverageGap ? { coverageGap: rule.coverageGap } : {}),
    };
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
    if (b.platforms !== undefined && (!Array.isArray(b.platforms) || !b.platforms.length || b.platforms.some((p) => typeof p !== 'string'))) problems.push(`${owner}: platforms must be a non-empty array of platform names`);
    problems.push(...checkSource(root, lock, b.source, owner));
    const tests = expandTests(b.tests ?? [], catalog, undefined, lists, problems, owner);
    checkTestFiles(root, tests, problems, owner);
    records.push({
      id: owner,
      kind: 'behavioral',
      title: b.title,
      specSection: b.specSection,
      source: b.source?.specOnly ? { specOnly: true, reason: b.source.reason } : b.source && existsSync(join(root, b.source.file ?? '')) ? spanFacts(root, b.source) : null,
      observable: b.observable,
      invariants: b.invariants,
      piMechanism: b.piMechanism,
      dependencies: b.dependencies,
      prerequisites: b.prerequisites,
      applicability: b.applicability,
      verification: b.verification,
      tests,
      ...(b.platforms ? { platforms: b.platforms } : {}),
      ...(b.coverageGap ? { coverageGap: b.coverageGap } : {}),
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
  if (!Array.isArray(lines) || lines.length !== 2 || !Number.isInteger(lines[0]) || !Number.isInteger(lines[1]) || lines[0] < 1 || lines[1] < lines[0])
    return [`${owner}: source lines for ${file} must be [first, last] with 1 <= first <= last`];
  const buffer = readFileSync(join(root, file));
  if (buffer.includes(0)) return [`${owner}: ${file} is binary, so it has no line span`];
  const content = buffer.toString('utf8').replace(/\n$/, '').split('\n');
  if (lines[1] > content.length) return [`${owner}: source span ${file}:${lines[0]}-${lines[1]} is past the end of the file (${content.length} lines)`];
  if (lines[1] - lines[0] + 1 > MAX_SPAN_LINES) problems.push(`${owner}: span ${file}:${lines[0]}-${lines[1]} is longer than ${MAX_SPAN_LINES} lines; cite the lines it derives from`);
  if (typeof anchor !== 'string' || !anchor.trim()) problems.push(`${owner}: source needs an anchor, a phrase that appears in the span`);
  else if (
    !content
      .slice(lines[0] - 1, lines[1])
      .join('\n')
      .includes(anchor)
  )
    problems.push(`${owner}: anchor "${anchor}" is not in ${file}:${lines[0]}-${lines[1]}`);
  return problems;
}

const key = (file, name) => `${file}::${name}`;

export function indexResults(report, root) {
  // `root` is the directory the report's absolute paths are relative to: the checkout that ran the tests.
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

/** A failure on any platform is a failure. Otherwise a pass counts only from a run on a platform the requirement targets. */
export function mergeOutcomes(record, byRun) {
  const bad = byRun.find((r) => r.outcome === 'failed' || r.outcome === 'failed-to-run');
  if (bad) return bad.outcome;
  const targets = record.platforms;
  const eligible = targets?.length ? byRun.filter((r) => targets.includes(r.platform)) : byRun;
  if (eligible.some((r) => r.outcome === 'passed')) return 'passed';
  return eligible.find((r) => r.outcome !== 'missing')?.outcome ?? 'missing';
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

const asRuns = (input) => (Array.isArray(input) ? input : [{ report: input, identity: { platform: 'unspecified' } }]);

/** `input` is one vitest report or a list of { report, identity: { platform } }. */
export function evaluate(records, input, root) {
  const runs = asRuns(input).map((run) => ({ platform: run.identity.platform, index: indexResults(run.report, run.identity.root ?? root) }));
  return records.map((record) => {
    const results = record.tests.map((t) => {
      const byRun = runs.map((run) => ({ platform: run.platform, outcome: outcomeOf(run.index.byTest.get(key(t.file, t.name)), run.index.failedFiles.has(t.file)) }));
      return { file: t.file, name: t.name, outcome: mergeOutcomes(record, byRun), byRun };
    });
    return { ...record, results, ...deriveStatus(record, results) };
  });
}

/** Results the gate reads, which cannot bind themselves: the manifest, the result files, and the status section generated from them. */
const SELF_REFERENTIAL = [/^generated\/parity-manifest\.json$/, /^parity-results\//];
const STATUS_DOC = 'docs/parity-status.md';
/** The lockfile and the workspace configuration above the package decide which dependencies the tests ran against. */
const WORKSPACE_INPUTS = ['bun.lock', 'package.json', 'tsconfig.json'];

/**
 * Hash of everything the tests can depend on, so a result is tied to the code it ran against: every tracked file in the package
 * (sources, adapters, generated and vendored trees, helper bundles, package.json, tsconfig and vitest config) and the workspace
 * lockfile, less the results themselves. Listing the files to include would miss the next kind of input; listing what is excluded cannot.
 */
export function sourceDigest(root) {
  try {
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    const files = git('ls-files', '-z', '--', '.')
      .split('\0')
      .filter((f) => f && !SELF_REFERENTIAL.some((re) => re.test(f)))
      .sort();
    if (!files.length) return null;
    const hash = createHash('sha256');
    const add = (label, buffer) => hash.update(`${label}\0${sha256(buffer)}\n`);
    for (const f of files) {
      const buffer = readFileSync(join(root, f));
      add(f, f === STATUS_DOC ? Buffer.from(spliceStatusSection(buffer.toString('utf8'), '')) : buffer);
    }
    const top = git('rev-parse', '--show-toplevel').trim();
    if (realpathSync(top) !== realpathSync(root)) for (const name of WORKSPACE_INPUTS) if (existsSync(join(top, name))) add(`workspace:${name}`, readFileSync(join(top, name)));
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/** Every failed test of a report, linked to a requirement or not, as `file::name`, plus each suite that failed with no failed test to show for it. */
export function failedTests(report, root) {
  const failures = [];
  for (const suite of report.testResults ?? []) {
    const file = isAbsolute(suite.name) ? relative(root, suite.name).split('\\').join('/') : suite.name;
    const failed = (suite.assertionResults ?? []).filter((a) => a.status === 'failed');
    for (const a of failed) failures.push(key(file, a.fullName));
    if (suite.status === 'failed' && !failed.length) failures.push(key(file, '(suite failed)'));
  }
  return failures;
}

/** What a run is attributed to: the checkout's commit, whether it was dirty, and the digest of the code the tests can see. */
export function sourceState(root) {
  const git = (...args) => {
    try {
      return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  const status = git('status', '--porcelain', '--untracked-files=all', '--', '.');
  // Paths that are not committed, minus machine-written results (excluded from the digest too): a path that appears here during a
  // run is an input the digest cannot see.
  const changes =
    status === null
      ? null
      : status
          .split('\n')
          .filter(Boolean)
          .map((line) => line.slice(3))
          .filter((path) => !/(^|\/)parity-results\//.test(path));
  return { commit: git('rev-parse', 'HEAD'), dirty: Boolean(status), changes, sourceDigest: sourceDigest(root) };
}

/** `attributed` overrides what this checkout would say, so a report recorded at another time or place is never stamped with the current code. */
export function runIdentity(root, report, resultsSource, attributed = {}) {
  return {
    platform: process.platform,
    startedAt: report.startTime ? new Date(report.startTime).toISOString() : null,
    generatedAt: new Date().toISOString(),
    ...sourceState(root),
    resultsSource,
    totalTests: report.numTotalTests ?? null,
    passedTests: report.numPassedTests ?? null,
    failedTests: report.numFailedTests ?? null,
    failures: failedTests(report, attributed.root ?? root),
    skippedTests: report.numPendingTests ?? null,
    ...attributed,
  };
}

/** A report with no sidecar says nothing about when or where it ran, so it carries no commit, platform or digest and cannot open the gate. */
export const UNATTRIBUTED = { platform: null, commit: null, dirty: null, sourceDigest: null };

/**
 * Judges a finished `vitest run --reporter=json`. Exit 1 is how Vitest reports failing tests and its report then counts them; any other
 * exit, a signal, or a report that is missing, truncated, or does not account for every suite and test is not a run.
 */
export function vitestRunOutcome({ status, signal, error }, reportText) {
  if (error) return { problem: `could not start Vitest: ${error.message}` };
  if (signal) return { problem: `Vitest was killed by ${signal}` };
  if (status !== 0 && status !== 1) return { problem: `Vitest exited ${status}` };
  if (reportText === null) return { problem: `Vitest exited ${status} and wrote no JSON report` };
  let report;
  try {
    report = JSON.parse(reportText);
  } catch (e) {
    return { problem: `the Vitest JSON report is not valid JSON (${e.message})` };
  }
  const counts = ['numTotalTests', 'numPassedTests', 'numFailedTests'];
  const bad = counts.filter((k) => !Number.isInteger(report?.[k]) || report[k] < 0);
  if (bad.length || !Array.isArray(report.testResults)) return { problem: `the Vitest JSON report is incomplete: ${[...bad, ...(Array.isArray(report?.testResults) ? [] : ['testResults'])].join(', ')} missing or invalid` };
  if (!report.numTotalTests) return { problem: 'the Vitest run executed no tests' };
  const listed = report.testResults.reduce((n, f) => n + (f.assertionResults?.length ?? 0), 0);
  if (listed !== report.numTotalTests) return { problem: `the Vitest JSON report lists ${listed} test(s) of ${report.numTotalTests}` };
  const statuses = report.testResults.flatMap((f) => (f.assertionResults ?? []).map((a) => a.status));
  const listedPassed = statuses.filter((s) => s === 'passed').length;
  const listedFailed = statuses.filter((s) => s === 'failed').length;
  const countedSkipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  if (report.numPassedTests !== listedPassed || report.numFailedTests !== listedFailed || countedSkipped !== statuses.length - listedPassed - listedFailed) {
    return {
      problem: `the Vitest JSON report counts ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${countedSkipped} skipped but lists ${listedPassed} passed, ${listedFailed} failed, ${statuses.length - listedPassed - listedFailed} skipped`,
    };
  }
  const failed = failedTests(report, '/').length;
  if (status === 0 && (report.success !== true || failed || report.numFailedTests)) return { problem: 'Vitest exited 0 but its report records failures' };
  if (status === 1 && report.success !== false) return { problem: 'Vitest exited 1 but its report says it succeeded' };
  if (status === 1 && !failed && !report.numFailedTests) return { problem: 'Vitest exited 1 but its report names no failed test' };
  return { report };
}

const SIDECAR_FIELDS = ['platform', 'commit', 'sourceDigest', 'runUrl', 'root'];

/** A result file recorded elsewhere (CI) must say what it is. Returns { identity } or { problem }.
 * A local sidecar (resultsSource "local", written by `build-parity-manifest.mjs` around its own Vitest run) carries the commit, dirty flag and digest taken at run time. */
export function sidecarIdentity(sidecar) {
  if (sidecar?.resultsSource === 'local') {
    const missing = ['platform', 'commit'].filter((f) => typeof sidecar[f] !== 'string' || !sidecar[f].trim());
    if (!/^[0-9a-f]{64}$/.test(sidecar.sourceDigest ?? '')) missing.push('sourceDigest');
    if (typeof sidecar.dirty !== 'boolean') missing.push('dirty');
    if (missing.length) return { problem: `identity is missing ${missing.join(', ')}` };
    return { identity: { resultsSource: 'local', platform: sidecar.platform, commit: sidecar.commit, dirty: sidecar.dirty, sourceDigest: sidecar.sourceDigest } };
  }
  const missing = SIDECAR_FIELDS.filter((f) => typeof sidecar?.[f] !== 'string' || !sidecar[f].trim());
  if (missing.length) return { problem: `identity is missing ${missing.join(', ')}` };
  return { identity: Object.fromEntries(SIDECAR_FIELDS.map((f) => [f, sidecar[f]])) };
}

/** Problems that make a manifest's recorded runs untrustworthy: unattributed, or recorded against other code than the tree now holds. */
export function checkRuns(manifest, currentDigest) {
  const problems = [];
  const runs = manifest.runs ?? [];
  if (!runs.length) problems.push('manifest records no result file; rebuild it');
  runs.forEach((run, i) => {
    const label = `result ${i + 1} (${run.platform ?? 'unknown platform'})`;
    const failures = Array.isArray(run.failures) ? run.failures : undefined;
    if (failures === undefined) problems.push(`${label}: records no failed-test identities; rebuild it`);
    else if (failures.length || (run.failedTests ?? 0) > 0) {
      const named = failures.length ? `: ${failures.slice(0, 5).join('; ')}${failures.length > 5 ? `; and ${failures.length - 5} more` : ''}` : '';
      problems.push(`${label}: ${Math.max(failures.length, run.failedTests ?? 0)} test(s) failed in the recorded run, whether or not a requirement links them${named}`);
    }
    if (run.dirty === true) problems.push(`${label}: recorded from a tree with uncommitted changes; commit them and rerun`);
    if (typeof run.platform !== 'string' || !run.platform) problems.push(`${label}: no platform recorded; the result is unattributed`);
    if (run.resultsSource === 'ci' && (typeof run.commit !== 'string' || !run.commit)) problems.push(`${label}: no commit recorded; the result is unattributed`);
    if (run.resultsSource === 'ci' && !run.runUrl) problems.push(`${label}: a CI result without its run URL is unattributed`);
    const recorded = typeof run.sourceDigest === 'string' && /^[0-9a-f]{64}$/.test(run.sourceDigest);
    if (!currentDigest) problems.push(`${label}: the code it ran against cannot be hashed now, so the result cannot be tied to the tree`);
    if (recorded && currentDigest && run.sourceDigest !== currentDigest) problems.push(`${label}: stale, it ran against code that has since changed (commit ${run.commit?.slice(0, 12)}); rerun it`);
    if (!recorded) problems.push(`${label}: no source digest recorded; the result is unattributed`);
  });
  return problems;
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

export const sourceLabel = (r) =>
  r.source?.file
    ? `${r.source.file}${r.source.lines ? `:${r.source.lines[0]}-${r.source.lines[1]}` : ''}`
    : r.source?.files
      ? `${r.source.files.length} files under ${r.source.files[0].file.split('/').slice(0, 4).join('/')}`
      : r.source?.specOnly
        ? `specification ${r.specSection}`
        : 'no source';

export const MARKERS = ['<!-- parity-status:begin (generated by scripts/build-parity-manifest.mjs; do not edit) -->', '<!-- parity-status:end -->'];

export function renderStatusSection(manifest) {
  const { evaluated: rows, run, counts } = { evaluated: manifest.requirements, run: manifest.run, counts: manifest.counts };
  const cell = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [
    MARKERS[0],
    '',
    `Computed from the Vitest result files below, by \`node scripts/build-parity-manifest.mjs\`. A requirement is PASS only when every linked test ran and passed on a platform it targets, and a failure on any platform is FAIL. A skipped, missing, or unlinked test is INCONCLUSIVE. \`node scripts/check-release.mjs\` exits non-zero until every mandatory requirement is PASS.`,
    '',
    '| Result | Platform | Commit | Tests | Run |',
    '| --- | --- | --- | --- | --- |',
    ...(manifest.runs ?? [run]).map((r, i) => `| ${i + 1} | ${r.platform ?? 'unknown'} | \`${r.commit?.slice(0, 12) ?? 'unknown'}\`${r.dirty ? ' (dirty tree)' : ''} | ${r.passedTests ?? '?'} passed, ${r.failedTests ?? '?'} failed, ${r.skippedTests ?? '?'} skipped | ${r.runUrl ?? `${r.resultsSource ?? 'local'} at ${r.generatedAt}`} |`),
    '',
    '| Kind | PASS | FAIL | INCONCLUSIVE | N/A |',
    '| --- | --- | --- | --- | --- |',
  ];
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
