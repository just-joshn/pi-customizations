import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

export const VERDICTS = ['verified', 'failed', 'inconclusive', 'env-limited', 'not-drivable'];
export const SCOPES = ['discovery', 'behaviour'];

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Receipt field ${field} must be a non-empty string`);
  return value;
}

function requiredScope(value) {
  if (!SCOPES.includes(value)) throw new Error(`Receipt field scope must be one of ${SCOPES.join(', ')}, got ${JSON.stringify(value)}`);
  return value;
}

export function validateReceipt(receipt) {
  requiredString(receipt.surface_id, 'surface_id');
  requiredString(receipt.package, 'package');
  requiredString(receipt.scenario, 'scenario');
  requiredString(receipt.expected, 'expected');
  requiredString(receipt.observed, 'observed');
  requiredString(receipt.evidence, 'evidence');
  requiredString(receipt.head_sha, 'head_sha');
  requiredString(receipt.pi_version, 'pi_version');
  requiredString(receipt.checked_at, 'checked_at');
  if (!VERDICTS.includes(receipt.verdict)) throw new Error(`Receipt ${receipt.surface_id} has unknown verdict '${receipt.verdict}'`);
  requiredScope(receipt.scope);
  if (receipt.verdict !== 'verified' && (typeof receipt.reason !== 'string' || receipt.reason.trim().length === 0)) {
    throw new Error(`Receipt ${receipt.surface_id} with verdict '${receipt.verdict}' requires a specific reason`);
  }
  if (receipt.observed === receipt.expected) throw new Error(`Receipt ${receipt.surface_id} observed value repeats expected verbatim`);
  return receipt;
}

export function createReceipts({ scenario, artifactsRoot, receiptDir = artifactsRoot ? join(artifactsRoot, scenario) : undefined, repoRoot = process.cwd() }) {
  const piBin = process.env.PI_BIN ?? 'pi';
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const piVersion = execFileSync(piBin, ['--version'], { encoding: 'utf8' }).trim();
  if (!receiptDir) throw new Error('createReceipts requires receiptDir or artifactsRoot');
  const written = [];

  function evidencePath(path) {
    if (!path) return path;
    const absolute = isAbsolute(path) ? path : join(repoRoot, path);
    const repoRelative = relative(repoRoot, absolute);
    return repoRelative.startsWith('..') ? absolute : repoRelative;
  }

  function write({ surfaceId, package: packageName, expected, observed, evidence, verdict = 'verified', scope = 'behaviour', reason = null, checkedAt = new Date().toISOString() }) {
    const receipt = {
      surface_id: surfaceId,
      package: packageName,
      scenario,
      verdict,
      scope,
      expected,
      observed,
      evidence: evidencePath(evidence),
      head_sha: headSha,
      pi_version: piVersion,
      checked_at: checkedAt,
      reason: verdict === 'verified' ? null : reason,
    };
    validateReceipt(receipt);
    mkdirSync(receiptDir, { recursive: true });
    writeFileSync(join(receiptDir, `${surfaceId}.json`), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    written.push(receipt);
    return receipt;
  }

  function assertVerdict({ surfaceId, package: packageName, expected, observed, evidence, scope, check }) {
    if (typeof check !== 'function') throw new Error(`assertVerdict for ${surfaceId} requires a check function`);
    try {
      check();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      write({ surfaceId, package: packageName, expected, observed, evidence, verdict: 'failed', scope, reason });
      throw new Error(`Assertion failed for ${surfaceId}: ${reason}`);
    }
    return write({ surfaceId, package: packageName, expected, observed, evidence, verdict: 'verified', scope });
  }

  return {
    scenario,
    dir: receiptDir,
    headSha,
    piVersion,
    write,
    assertVerdict,
    receipts() {
      return [...written];
    },
    failed() {
      return written.filter((receipt) => receipt.verdict === 'failed');
    },
  };
}
