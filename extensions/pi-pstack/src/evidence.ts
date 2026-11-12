// pstack_evidence (spec 7 invariants 3-5, 8.4): records worker receipts in verification/verdicts.json and re-checks
// them. An absent receipt, or one with nothing to re-check, never becomes a pass.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { isInside, parseRunId, projectRoot, type RunId, readJson, runRootOf, writeJsonAtomic } from './run-files.ts';

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

interface Verdicts {
  schemaVersion: 1;
  receipts: RecordedReceipt[];
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

const verdictsPath = (runRoot: string) => join(runRoot, 'verification', 'verdicts.json');

function readVerdicts(runRoot: string): Verdicts {
  const path = verdictsPath(runRoot);
  return existsSync(path) ? (readJson(path) as Verdicts) : { schemaVersion: 1, receipts: [] };
}

/** Parent and worker processes may record at once; a lock directory serializes the read-modify-rename. */
async function withVerdictsLock<T>(runRoot: string, body: () => T): Promise<T> {
  const lock = join(runRoot, 'verification', 'verdicts.lock');
  mkdirSync(join(runRoot, 'verification'), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'pid'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = Number(existsSync(join(lock, 'pid')) ? readFileSync(join(lock, 'pid'), 'utf8') : NaN);
      const dead = Number.isInteger(owner) && !alive(owner);
      const old = Date.now() - statSync(lock).mtimeMs > 30_000;
      if (dead || old) rmSync(lock, { recursive: true, force: true });
      else if (attempt > 200) throw new Error(`${lock} is held by pid ${owner}`);
      else await new Promise((wait) => setTimeout(wait, 25));
    }
  }
  try {
    return body();
  } finally {
    rmSync(join(lock, 'pid'), { force: true });
    rmdirSync(lock);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function recordReceipt(runRoot: string, runId: RunId, receiptPath: string): Promise<RecordedReceipt> {
  const path = isAbsolute(receiptPath) ? receiptPath : resolve(runRoot, receiptPath);
  if (!isInside(runRoot, path)) throw new Error(`Receipt ${receiptPath} is outside run ${runId}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Receipt ${receiptPath} is not a file`);
  const receipt = parseReceipt(readJson(path), runId);
  for (const artifact of receipt.artifacts) if (!isInside(runRoot, artifactPath(runRoot, artifact.path))) throw new Error(`Artifact ${artifact.path} is outside run ${runId}`);
  return withVerdictsLock(runRoot, () => {
    const verdicts = readVerdicts(runRoot);
    const existing = verdicts.receipts.find((entry) => entry.receipt.id === receipt.id);
    if (existing !== undefined) {
      if (JSON.stringify(existing.receipt) !== JSON.stringify(receipt)) throw new Error(`Receipt id ${receipt.id} is already recorded with different content`);
      return existing;
    }
    const recorded: RecordedReceipt = { receipt, receiptPath: path, recordedAt: new Date().toISOString() };
    writeJsonAtomic(verdictsPath(runRoot), { schemaVersion: 1, receipts: [...verdicts.receipts, recorded] } satisfies Verdicts, 0o644);
    return recorded;
  });
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Re-checks every recorded receipt for `target`: a TODO step id, a worker id, or a commit. */
export function verifyTarget(runRoot: string, target: string): EvidenceVerdict {
  const matching = readVerdicts(runRoot).receipts.filter((entry) => entry.receipt.target === target);
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
  action: StringEnum(['record', 'verify', 'list'] as const, { description: 'record appends a receipt file to the run verdicts; verify re-checks every receipt for a target; list shows recorded receipts.' }),
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
      'Record and verify pstack evidence receipts for a run. record validates a receipt JSON file under .pi/pstack/runs/<runId>/ and appends it to verification/verdicts.json. verify re-checks every receipt for a target (a TODO step id, worker id, or commit): files exist, sha256 matches, and the commit matches when the target is a commit. It returns pass, fail, or inconclusive; a missing receipt is inconclusive, never pass. list shows recorded receipts.',
    promptSnippet: 'Record and verify pstack evidence receipts (pass, fail, or inconclusive)',
    parameters: EvidenceParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const runId = parseRunId(params.runId);
      const runRoot = evidenceRunRoot(ctx.cwd, runId);
      if (!existsSync(runRoot)) throw new Error(`Run ${runId} does not exist at ${runRoot}`);
      if (params.action === 'record') {
        if (params.receiptPath === undefined) throw new Error('receiptPath is required');
        const recorded = await recordReceipt(runRoot, runId, params.receiptPath);
        return text(`Recorded receipt ${recorded.receipt.id} for ${recorded.receipt.target} (${recorded.receipt.verdict}).`, recorded);
      }
      if (params.action === 'verify') {
        if (params.target === undefined || params.target === '') throw new Error('target is required');
        const verdict = verifyTarget(runRoot, params.target);
        const detail = verdict.kind === 'fail' ? `\n${verdict.defects.join('\n')}` : verdict.kind === 'inconclusive' ? `\n${verdict.reason}` : '';
        return text(`${params.target}: ${verdict.kind}${detail}`, verdict);
      }
      const receipts = readVerdicts(runRoot).receipts;
      return text(receipts.length === 0 ? 'No receipts recorded.' : receipts.map(({ receipt }) => `${receipt.id} ${receipt.target} ${receipt.kind} ${receipt.verdict}`).join('\n'), { receipts });
    },
  });
}
