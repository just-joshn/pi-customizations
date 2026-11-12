// pstack_evidence (spec 7 invariants 3-5, 8.4): records worker receipts as verification/receipts/<id>.json and re-checks
// them. An absent receipt, or one with nothing to re-check, never becomes a pass.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { isInside, parseRunId, projectRoot, type RunId, readJson, runRootOf } from './run-files.ts';

const ReceiptSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
    runId: Type.String(),
    target: Type.String({ minLength: 1 }),
    kind: Type.Union(['test', 'command', 'screenshot', 'trace', 'review', 'measurement', 'other'].map((kind) => Type.Literal(kind))),
    verdict: Type.Union([Type.Literal('pass'), Type.Literal('fail'), Type.Literal('inconclusive')]),
    commit: Type.Union([Type.String(), Type.Null()]),
    environment: Type.String(),
    command: Type.Optional(Type.Array(Type.String())),
    exitCode: Type.Optional(Type.Integer()),
    artifacts: Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }) }, { additionalProperties: false })),
    defects: Type.Optional(Type.Array(Type.String())),
    reason: Type.Optional(Type.String()),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export type Receipt = Static<typeof ReceiptSchema>;

export interface RecordedReceipt {
  receipt: Receipt;
  receiptPath: string;
  recordedAt: string;
}

export type EvidenceVerdict = { kind: 'pass'; receipts: string[] } | { kind: 'fail'; receipts: string[]; defects: string[] } | { kind: 'inconclusive'; reason: string; receipts: string[] };

const COMMIT = /^[0-9a-f]{7,64}$/;

export function parseReceipt(raw: unknown, runId: RunId): Receipt {
  if (!Value.Check(ReceiptSchema, raw)) {
    const first = Value.Errors(ReceiptSchema, raw)[0];
    throw new Error(`Invalid receipt${first === undefined ? '' : ` at ${first.instancePath || '/'}: ${first.message}`}`);
  }
  if (raw.runId !== runId) throw new Error(`Receipt runId ${raw.runId} is not ${runId}`);
  return raw;
}

/** Artifact paths are relative to the run root, or absolute inside it. */
const artifactPath = (runRoot: string, path: string): string => (isAbsolute(path) ? path : resolve(runRoot, path));

const receiptsDir = (runRoot: string) => join(runRoot, 'verification', 'receipts');
const RECEIPT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

function readRecorded(runRoot: string, runId: RunId, file: string): RecordedReceipt {
  const path = join(receiptsDir(runRoot), file);
  const raw = readJson(path) as Partial<RecordedReceipt>;
  const receipt = parseReceipt(raw.receipt, runId);
  if (`${receipt.id}.json` !== file || typeof raw.receiptPath !== 'string' || typeof raw.recordedAt !== 'string') throw new Error(`${path} is not a recorded receipt`);
  return { receipt, receiptPath: raw.receiptPath, recordedAt: raw.recordedAt };
}

/** Every recorded receipt, read from verification/receipts/. Each file is complete, because record links it into place whole. */
export function listReceipts(runRoot: string, runId: RunId): RecordedReceipt[] {
  const dir = receiptsDir(runRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => RECEIPT_FILE.test(file))
    .map((file) => readRecorded(runRoot, runId, file))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.receipt.id.localeCompare(b.receipt.id));
}

/**
 * Stores the receipt as verification/receipts/<id>.json. Each recorder writes its own temporary file and hard-links it
 * to the receipt name, which fails if the name exists, so concurrent recorders share no file and need no lock, and a
 * crash leaves at most a temporary file that no reader looks at. Recording the same id again is idempotent when the
 * receipt is identical, and an error when it differs.
 */
export function recordReceipt(runRoot: string, runId: RunId, receiptPath: string): RecordedReceipt {
  const path = isAbsolute(receiptPath) ? receiptPath : resolve(runRoot, receiptPath);
  if (!isInside(runRoot, path)) throw new Error(`Receipt ${receiptPath} is outside run ${runId}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Receipt ${receiptPath} is not a file`);
  const receipt = parseReceipt(readJson(path), runId);
  for (const artifact of receipt.artifacts) if (!isInside(runRoot, artifactPath(runRoot, artifact.path))) throw new Error(`Artifact ${artifact.path} is outside run ${runId}`);
  const dir = receiptsDir(runRoot);
  mkdirSync(dir, { recursive: true });
  const recorded: RecordedReceipt = { receipt, receiptPath: path, recordedAt: new Date().toISOString() };
  const temporary = join(dir, `.${receipt.id}.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(recorded, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
  try {
    linkSync(temporary, join(dir, `${receipt.id}.json`));
    return recorded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = readRecorded(runRoot, runId, `${receipt.id}.json`);
    if (!isDeepStrictEqual(existing.receipt, receipt)) throw new Error(`Receipt id ${receipt.id} is already recorded with different content`);
    return existing;
  } finally {
    rmSync(temporary, { force: true });
  }
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Re-checks every recorded receipt for `target`: a TODO step id, a worker id, or a commit. */
export function verifyTarget(runRoot: string, runId: RunId, target: string): EvidenceVerdict {
  const matching = listReceipts(runRoot, runId).filter((entry) => entry.receipt.target === target);
  const ids = matching.map((entry) => entry.receipt.id);
  if (matching.length === 0) return { kind: 'inconclusive', reason: `No receipt recorded for ${target}`, receipts: [] };
  const defects: string[] = [];
  const unverifiable: string[] = [];
  for (const { receipt } of matching) {
    if (COMMIT.test(target) && receipt.commit !== target) defects.push(`${receipt.id}: examined commit ${receipt.commit ?? '(none)'}, not ${target}`);
    for (const artifact of receipt.artifacts) {
      const path = artifactPath(runRoot, artifact.path);
      if (!isInside(runRoot, path)) defects.push(`${receipt.id}: artifact ${artifact.path} is outside the run`);
      else if (!existsSync(path)) defects.push(`${receipt.id}: artifact ${artifact.path} is missing`);
      else if (sha256(path) !== artifact.sha256) defects.push(`${receipt.id}: artifact ${artifact.path} does not match its sha256`);
    }
    if (receipt.verdict === 'fail') {
      const listed = receipt.defects ?? [];
      defects.push(...(listed.length > 0 ? listed : [`recorded verdict fail${receipt.reason === undefined ? '' : ` (${receipt.reason})`}`]).map((defect) => (defect.startsWith(`${receipt.id}:`) ? defect : `${receipt.id}: ${defect}`)));
    } else if (receipt.verdict === 'pass' && receipt.exitCode !== undefined && receipt.exitCode !== 0) defects.push(`${receipt.id}: a pass whose command exited ${receipt.exitCode} contradicts itself`);
    else if (receipt.verdict === 'inconclusive') unverifiable.push(`${receipt.id}: recorded verdict inconclusive${receipt.reason === undefined ? '' : ` (${receipt.reason})`}`);
    else if (receipt.artifacts.length === 0) unverifiable.push(`${receipt.id}: a pass with no artifacts is an assertion, not evidence`);
  }
  if (defects.length > 0) return { kind: 'fail', receipts: ids, defects };
  if (unverifiable.length > 0) return { kind: 'inconclusive', reason: unverifiable.join('; '), receipts: ids };
  return { kind: 'pass', receipts: ids };
}

/** A worker's host exports its run root; the parent finds it from its project. */
export function evidenceRunRoot(cwd: string, runId: RunId): string {
  const exported = process.env['PSTACK_RUN_ROOT'];
  if (exported !== undefined && exported !== '' && basename(exported) === runId) return exported;
  return runRootOf(projectRoot(cwd), runId);
}

const EvidenceParams = Type.Object({
  action: StringEnum(['record', 'verify', 'list'] as const, { description: 'record stores a receipt file as verification/receipts/<id>.json; verify re-checks every receipt for a target; list shows recorded receipts.' }),
  runId: Type.String({ description: 'The run id (the folder under .pi/pstack/runs).' }),
  receiptPath: Type.Optional(Type.String({ description: 'record: the receipt JSON file, inside the run root.' })),
  target: Type.Optional(Type.String({ description: 'verify: a TODO step id, worker id, or commit.' })),
});

const text = (value: string, details: unknown) => ({ content: [{ type: 'text' as const, text: value }], details });

export function registerEvidenceTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pstack_evidence',
    label: 'pstack evidence',
    description:
      'Record and verify pstack evidence receipts for a run. record validates a receipt JSON file under .pi/pstack/runs/<runId>/ and stores it as verification/receipts/<id>.json (recording an identical receipt again is a no-op; a different receipt with a recorded id is an error). verify re-checks every receipt for a target (a TODO step id, worker id, or commit): files exist, sha256 matches, and the commit matches when the target is a commit. It returns pass, fail, or inconclusive; a missing receipt is inconclusive, never pass. list shows recorded receipts.',
    promptSnippet: 'Record and verify pstack evidence receipts (pass, fail, or inconclusive)',
    parameters: EvidenceParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const runId = parseRunId(params.runId);
      const runRoot = evidenceRunRoot(ctx.cwd, runId);
      if (!existsSync(runRoot)) throw new Error(`Run ${runId} does not exist at ${runRoot}`);
      if (params.action === 'record') {
        if (params.receiptPath === undefined) throw new Error('receiptPath is required');
        const recorded = recordReceipt(runRoot, runId, params.receiptPath);
        return text(`Recorded receipt ${recorded.receipt.id} for ${recorded.receipt.target} (${recorded.receipt.verdict}).`, recorded);
      }
      if (params.action === 'verify') {
        if (params.target === undefined || params.target === '') throw new Error('target is required');
        const verdict = verifyTarget(runRoot, runId, params.target);
        const detail = verdict.kind === 'fail' ? `\n${verdict.defects.join('\n')}` : verdict.kind === 'inconclusive' ? `\n${verdict.reason}` : '';
        return text(`${params.target}: ${verdict.kind}${detail}`, verdict);
      }
      const receipts = listReceipts(runRoot, runId);
      return text(receipts.length === 0 ? 'No receipts recorded.' : receipts.map(({ receipt }) => `${receipt.id} ${receipt.target} ${receipt.kind} ${receipt.verdict}`).join('\n'), { receipts });
    },
  });
}
