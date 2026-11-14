import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { sourceDigest } from './parity-lib.mjs';

const REVISION = '3dbd22ff12742fb28c9700b9760baa29ed41dc13';
const ACCEPTANCE = [
  'SRC-01',
  'ROUTE-01',
  'TODO-01',
  'ROLE-01',
  'PROC-01',
  'PROC-02',
  'MCP-01',
  'SANDBOX-01',
  'TRUST-01',
  'PLAN-01',
  'VERIFY-01',
  'FORMAL-01',
  'ARENA-01',
  'SWARM-01',
  'INTERROGATE-01',
  'BENCH-01',
  'BABYSIT-01',
  'SHIP-01',
  'AUTOPILOT-01',
  'RECALL-01',
  'PAUSE-01',
  'CLEANUP-01',
  'REPORT-01',
];
const OBLIGATIONS = [
  ...Array.from({ length: 10 }, (_, i) => `ZIP-INV-${String(i + 1).padStart(2, '0')}`),
  'ZIP-MCP',
  'ZIP-PROCESSES',
  'ZIP-SECURITY',
  'ZIP-PLANS',
  'ZIP-TODOS',
  'ZIP-SUPERVISION',
  'ZIP-NATIVE',
  ...Array.from({ length: 11 }, (_, i) => `ZIP-PI-${String(i + 1).padStart(2, '0')}`),
  'ZIP-DONE',
  'ZIP-BENNY',
];
const DOCUMENTS = ['pstack_pi_end_to_end_map.html', 'pstack_pi_end_to_end_map.md', 'pstack_pi_playbooks.svg', 'pstack_pi_system.svg', 'pstack_pi_verification_report.md'];
const VERDICTS = ['PASS', 'FAIL', 'INCONCLUSIVE', 'BLOCKED'];
const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const zipRequirementDigest = (requirement) => sha(JSON.stringify(requirement));

export function validateZip(zip) {
  const problems = [];
  if (zip?.schemaVersion !== 1 || !Array.isArray(zip.requirements) || zip.requirements.some((r) => !r || typeof r !== 'object')) return ['ZIP: missing or unsupported authoritative requirement register'];
  if (zip.upstreamRevision !== REVISION) problems.push(`ZIP: source revision must be ${REVISION}`);
  const files = zip.authority?.files;
  if (!Array.isArray(files) || files.length !== DOCUMENTS.length || files.some((f) => !f || typeof f !== 'object') || DOCUMENTS.some((name) => files.filter((f) => f.file === name && /^[0-9a-f]{64}$/.test(f.sha256)).length !== 1))
    problems.push('ZIP: all five audited authority file hashes are required');
  for (const id of [...ACCEPTANCE, ...OBLIGATIONS]) if (zip.requirements.filter((r) => r.id === id && r.mandatory === true).length !== 1) problems.push(`ZIP: mandatory requirement ${id} is missing, duplicated or waived`);
  const seen = new Set();
  for (const r of zip.requirements) {
    if (!nonempty(r.id) || seen.has(r.id)) problems.push(`ZIP: invalid or duplicate requirement ${r.id}`);
    seen.add(r.id);
    if (r.mandatory !== true) problems.push(`${r.id}: ZIP requirements cannot be silently waived`);
    if (!nonempty(r.stimulus) || !nonempty(r.evidence)) problems.push(`${r.id}: exact stimulus and required evidence are mandatory`);
    if (!DOCUMENTS.includes(r.source?.document) || !Array.isArray(r.source?.lines) || r.source.lines.length !== 2 || !r.source.lines.every(Number.isInteger) || r.source.lines[0] < 1 || r.source.lines[1] < r.source.lines[0])
      problems.push(`${r.id}: a source document and exact line span are required`);
    if (!['FAIL', 'INCONCLUSIVE', 'BLOCKED'].includes(r.unresolved?.verdict) || !nonempty(r.unresolved?.reason)) problems.push(`${r.id}: unresolved verdict must explicitly remain non-PASS with a reason`);
  }
  return problems;
}

function artifactProblem(artifact, directory) {
  if (!nonempty(artifact?.path) || !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) return 'artifact needs a path and SHA-256';
  const path = resolve(directory, artifact.path);
  if (!existsSync(path)) return `missing artifact ${artifact.path}`;
  const rel = relative(realpathSync(directory), realpathSync(path));
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return `artifact leaves its evidence directory: ${artifact.path}`;
  if (!statSync(path).isFile() || statSync(path).size === 0) return `artifact is not a nonempty file: ${artifact.path}`;
  if (sha(readFileSync(path)) !== artifact.sha256) return `artifact hash mismatch: ${artifact.path}`;
  return null;
}

export function evaluateZip(root, inputs, evidencePath, piVersion) {
  const zip = inputs.requirements.zip;
  const problems = validateZip(zip);
  if (problems.length) return { status: 'NOT RELEASED', evidence: null, requirements: [], problems };
  const requirements = zip.requirements.map((r) => ({ ...r, status: r.unresolved.verdict, reason: r.unresolved.reason }));
  let evidence = null;
  let receipt = null;
  if (evidencePath) {
    const path = resolve(evidencePath);
    try {
      const bytes = readFileSync(path);
      evidence = { path, sha256: sha(bytes) };
      receipt = JSON.parse(bytes);
    } catch (error) {
      problems.push(`ZIP: unreadable evidence receipt ${path}: ${error.message}`);
    }
  }
  if (inputs.lock.revision !== REVISION) problems.push(`ZIP: upstream lock ${inputs.lock.revision} differs from audited ${REVISION}`);
  if (receipt) {
    const digest = sourceDigest(root);
    if (receipt.schemaVersion !== 1 || !Array.isArray(receipt.requirements)) problems.push('ZIP: invalid evidence receipt schema');
    if (!digest || receipt.sourceDigest !== digest) problems.push('ZIP: stale or missing evidence source digest');
    if (receipt.upstreamRevision !== REVISION) problems.push('ZIP: evidence uses the wrong source pin');
    if (!nonempty(piVersion) || receipt.piVersion !== piVersion) problems.push('ZIP: evidence does not name the current installed Pi version');
    const rows = Array.isArray(receipt.requirements) ? receipt.requirements.filter((row) => row && typeof row === 'object') : [];
    if (rows.length !== receipt.requirements?.length) problems.push('ZIP: invalid evidence requirement records');
    for (const row of rows) if (!requirements.some((r) => r.id === row.id)) problems.push(`ZIP: unknown evidence requirement ${row.id}`);
    for (const r of requirements) {
      const matches = rows.filter((row) => row.id === r.id);
      if (matches.length !== 1) {
        problems.push(`${r.id}: ${matches.length ? 'duplicate' : 'missing'} ZIP evidence`);
        continue;
      }
      const row = matches[0];
      const failures = [];
      const source = zip.requirements.find((entry) => entry.id === r.id);
      if (!VERDICTS.includes(row.verdict)) failures.push('unknown evidence verdict');
      if (row.requirementDigest !== zipRequirementDigest(source)) failures.push('stale requirement digest');
      if (row.stimulus !== r.stimulus || row.expected !== r.evidence) failures.push('evidence does not cover the exact ZIP stimulus and observation');
      if (!nonempty(row.command) || !nonempty(row.observed)) failures.push('actual command and observation are required');
      if (!Array.isArray(row.artifacts) || !row.artifacts.length) failures.push('hashed experiment artifacts are required');
      else
        for (const artifact of row.artifacts) {
          try {
            const problem = artifactProblem(artifact, dirname(evidence.path));
            if (problem) failures.push(problem);
          } catch (error) {
            failures.push(`unreadable experiment artifact: ${error.message}`);
          }
        }
      problems.push(...failures.map((failure) => `${r.id}: ${failure}`));
      if (!failures.length) {
        r.status = row.verdict;
        r.reason = row.observed;
      }
    }
  }
  if (problems.length)
    for (const r of requirements)
      if (r.status === 'PASS') {
        r.status = 'INCONCLUSIVE';
        r.reason = 'ZIP evidence or contract integrity validation failed';
      }
  return { status: requirements.length > 0 && !problems.length && requirements.every((r) => r.status === 'PASS') ? 'ACCEPTED' : 'NOT RELEASED', evidence, requirements, problems };
}
