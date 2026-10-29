#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CASES } from './lib/cases.mjs';
import { deepDiff, pathAllowed } from './lib/diff.mjs';
import { evidenceContractFailure, isErrorEnvelope } from './lib/evidence-contract.mjs';
import { normalizeForCompare } from './lib/normalize.mjs';
import { EVIDENCE_DIR, MISMATCHES_PATH } from './lib/paths.mjs';

const loadMismatches = () => {
  try {
    return JSON.parse(readFileSync(MISMATCHES_PATH, 'utf8'));
  } catch {
    return { version: 1, cases: {} };
  }
};

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const patternsFor = (mismatches, caseId) => {
  const entry = mismatches.cases?.[caseId];
  if (entry === undefined) return [];
  if (Array.isArray(entry.paths)) return entry.paths;
  return [];
};

const kindMismatchAllowed = (mismatches, caseId) => mismatches.cases?.[caseId]?.kind_mismatch === true;

const readPath = (value, path) => path.split('.').reduce((current, key) => (current === null || typeof current !== 'object' ? undefined : current[key]), value);

const writePath = (target, path, value) => {
  const keys = path.split('.');
  let cursor = target;
  for (const [index, key] of keys.entries()) {
    if (index === keys.length - 1) cursor[key] = value;
    else {
      cursor[key] ??= {};
      cursor = cursor[key];
    }
  }
};

const projectPaths = (body, paths) => {
  const out = {};
  for (const path of paths) writePath(out, path, readPath(body, path));
  return out;
};

const main = async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const mismatches = loadMismatches();
  const summary = { started_at: new Date().toISOString(), rea_agents: '6.8.0', cases: [], pass: 0, fail: 0, documented: 0 };

  const only = process.env.CASE?.trim();
  const selected = only ? CASES.filter((testCase) => testCase.id === only || testCase.tool === only) : CASES;
  if (only && selected.length === 0) {
    process.stderr.write(`No differential case matches CASE=${only}\n`);
    process.exit(2);
  }

  for (const testCase of selected) {
    process.stderr.write(`case ${testCase.id}...\n`);
    if (testCase.prepare) await testCase.prepare();
    const caseDir = join(EVIDENCE_DIR, testCase.id);
    mkdirSync(caseDir, { recursive: true });

    const pi = await testCase.runPiRea();
    const oracle = await testCase.runOracle();
    writeJson(join(caseDir, 'pi-rea.json'), pi);
    writeJson(join(caseDir, 'rea-agents.json'), oracle);

    const contractIssues = [];
    if (pi.kind === 'evidence') {
      const reason = evidenceContractFailure(pi.body, 'pi-rea');
      if (reason !== null) contractIssues.push({ side: 'pi-rea', reason });
    }
    if (oracle.kind === 'evidence') {
      const reason = evidenceContractFailure(oracle.body, 'rea-agents');
      if (reason !== null) contractIssues.push({ side: 'rea-agents', reason });
    }
    if (pi.kind === 'error' && !isErrorEnvelope(pi.body)) {
      contractIssues.push({ side: 'pi-rea', reason: 'error envelope missing code/category/message' });
    }
    if (oracle.kind === 'error' && !isErrorEnvelope(oracle.body)) {
      contractIssues.push({ side: 'rea-agents', reason: 'error envelope missing code/category/message' });
    }

    const normalizedLeft = normalizeForCompare(pi.kind, pi.body);
    const normalizedRight = normalizeForCompare(oracle.kind, oracle.body);
    const comparedPaths = Array.isArray(testCase.compare_paths) && testCase.compare_paths.length > 0 ? testCase.compare_paths : null;
    const left = comparedPaths === null ? normalizedLeft : projectPaths(normalizedLeft, comparedPaths);
    const right = comparedPaths === null ? normalizedRight : projectPaths(normalizedRight, comparedPaths);
    const diffs = pi.kind === oracle.kind ? deepDiff(left, right) : [{ path: '$kind', left: pi.kind, right: oracle.kind, kind: 'kind_mismatch' }];

    const allowedPatterns = patternsFor(mismatches, testCase.id);
    const undocumented = [];
    const documented = [];
    for (const diff of diffs) {
      if (diff.kind === 'kind_mismatch' && kindMismatchAllowed(mismatches, testCase.id)) {
        documented.push(diff);
        continue;
      }
      if (pathAllowed(diff.path, allowedPatterns)) documented.push(diff);
      else undocumented.push(diff);
    }

    const status = contractIssues.length > 0 ? 'fail_contract' : undocumented.length > 0 ? 'fail_undocumented' : diffs.length === 0 ? 'pass' : 'pass_documented';

    const report = {
      id: testCase.id,
      tool: testCase.tool,
      status,
      pi_kind: pi.kind,
      oracle_kind: oracle.kind,
      contract_issues: contractIssues,
      diff_count: diffs.length,
      compared_paths: comparedPaths,
      documented_count: documented.length,
      undocumented_count: undocumented.length,
      undocumented: undocumented.slice(0, 40),
      documented: documented.slice(0, 40),
    };
    writeJson(join(caseDir, 'diff-summary.json'), report);
    summary.cases.push({ id: testCase.id, tool: testCase.tool, status, diff_count: diffs.length, compared_paths: comparedPaths, undocumented_count: undocumented.length, contract_issues: contractIssues.length });
    if (status === 'pass' || status === 'pass_documented') {
      summary.pass += 1;
      if (status === 'pass_documented') summary.documented += 1;
    } else {
      summary.fail += 1;
    }
    process.stderr.write(`  ${status} (diffs=${diffs.length} undocumented=${undocumented.length} contract=${contractIssues.length})\n`);
  }

  summary.finished_at = new Date().toISOString();
  writeJson(join(EVIDENCE_DIR, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify({ pass: summary.pass, fail: summary.fail, documented: summary.documented, mismatches: MISMATCHES_PATH, summary: join(EVIDENCE_DIR, 'summary.json') })}\n`);
  if (summary.fail > 0) process.exit(1);
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(2);
});
