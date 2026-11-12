// pstack_evidence (spec 7 invariants 3-5, 8.4): records worker receipts as verification/receipts/<id>.json and re-checks
// them. An absent receipt, or one with nothing to re-check, never becomes a pass.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { isInside, parseRunId, parseWorkerId, projectRoot, type RunId, readJson, runRootOf, workerDirOf } from './run-files.ts';
import { readFileBelow } from './untrusted-output.ts';

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

/**
 * Where receipts and the files they name live. `base` is the run root, which relative paths are written against. `root` is the
 * tree a receipt and its artifacts must lie in, and `receipts` is where recorded receipts go. On the host all three belong to
 * the run. In a container worker the run root is not mounted, so `root` is the worker's own directory and `receipts` its inbox:
 * the host copies what is in the inbox into the run's receipts (see ingestContainerReceipts).
 */
export interface EvidenceScope {
  base: string;
  root: string;
  receipts: string;
}

const receiptsDir = (runRoot: string) => join(runRoot, 'verification', 'receipts');
const hostScope = (runRoot: string): EvidenceScope => ({ base: runRoot, root: runRoot, receipts: receiptsDir(runRoot) });
const scopeOf = (scope: string | EvidenceScope): EvidenceScope => (typeof scope === 'string' ? hostScope(scope) : scope);

/** Artifact paths are relative to the run root, or absolute inside it. */
const artifactPath = (base: string, path: string): string => (isAbsolute(path) ? path : resolve(base, path));

const RECEIPT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

function readRecorded(scope: EvidenceScope, runId: RunId, file: string): RecordedReceipt {
  const path = join(scope.receipts, file);
  const raw = readJson(path) as Partial<RecordedReceipt>;
  const receipt = parseReceipt(raw.receipt, runId);
  if (`${receipt.id}.json` !== file || typeof raw.receiptPath !== 'string' || typeof raw.recordedAt !== 'string') throw new Error(`${path} is not a recorded receipt`);
  return { receipt, receiptPath: raw.receiptPath, recordedAt: raw.recordedAt };
}

/** Every recorded receipt, read from verification/receipts/, and what a host run could not take in from its container workers. Each file is complete, because record links it into place whole. */
function readAll(runRoot: string | EvidenceScope, runId: RunId): { receipts: RecordedReceipt[]; rejected: IngestedReceipts['rejected'] } {
  const rejected = typeof runRoot === 'string' ? ingestContainerReceipts(runRoot, runId).rejected : [];
  const scope = scopeOf(runRoot);
  if (!existsSync(scope.receipts)) return { receipts: [], rejected };
  const receipts = readdirSync(scope.receipts)
    .filter((file) => RECEIPT_FILE.test(file))
    .map((file) => readRecorded(scope, runId, file))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.receipt.id.localeCompare(b.receipt.id));
  return { receipts, rejected };
}

/** Every recorded receipt. A host run first takes in the receipts its container workers recorded (see ingestContainerReceipts). */
export const listReceipts = (runRoot: string | EvidenceScope, runId: RunId): RecordedReceipt[] => readAll(runRoot, runId).receipts;

const describeRejected = (rejected: IngestedReceipts['rejected']): string => rejected.map(({ workerId, file, reason }) => `${workerId}/${file}: ${reason}`).join('; ');

/** linkSync's answers from a filesystem, or a directory, that cannot hold a second name for the temporary file. */
const NO_HARD_LINK = ['ENOTSUP', 'EPERM', 'EXDEV', 'EMLINK'];

/**
 * Stores the receipt as `<receipts>/<id>.json`. Each recorder writes its own temporary file and hard-links it
 * to the receipt name, which fails if the name exists, so concurrent recorders share no file and need no lock, and a
 * crash leaves at most a temporary file that no reader looks at. Recording the same id again is idempotent when the
 * receipt is identical, and an error when it differs.
 */
function storeReceipt(scope: EvidenceScope, runId: RunId, receipt: Receipt, source: string): RecordedReceipt {
  const dir = scope.receipts;
  mkdirSync(dir, { recursive: true });
  const recorded: RecordedReceipt = { receipt, receiptPath: source, recordedAt: new Date().toISOString() };
  const temporary = join(dir, `.${receipt.id}.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(recorded, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
  try {
    linkSync(temporary, join(dir, `${receipt.id}.json`));
    return recorded;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== undefined && NO_HARD_LINK.includes(code)) throw new Error(`Recording receipt ${receipt.id} needs a filesystem with hard links under ${dir} (link failed with ${code}); move the project to one that supports them`);
    if (code !== 'EEXIST') throw error;
    const existing = readRecorded(scope, runId, `${receipt.id}.json`);
    if (!isDeepStrictEqual(existing.receipt, receipt)) throw new Error(`Receipt id ${receipt.id} is already recorded with different content`);
    return existing;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function recordReceipt(runRoot: string | EvidenceScope, runId: RunId, receiptPath: string): RecordedReceipt {
  const scope = scopeOf(runRoot);
  const path = isAbsolute(receiptPath) ? receiptPath : resolve(scope.base, receiptPath);
  if (!isInside(scope.root, path)) throw new Error(`Receipt ${receiptPath} is outside ${scope.root === scope.base ? `run ${runId}` : `this worker's directory ${scope.root}`}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Receipt ${receiptPath} is not a file`);
  const receipt = parseReceipt(readJson(path), runId);
  for (const artifact of receipt.artifacts) if (!isInside(scope.root, artifactPath(scope.base, artifact.path))) throw new Error(`Artifact ${artifact.path} is outside ${scope.root === scope.base ? `run ${runId}` : `this worker's directory ${scope.root}`}`);
  return storeReceipt(scope, runId, receipt, path);
}

export interface IngestedReceipts {
  /** Receipt ids now in the run's receipts, whether this pass stored them or an earlier one did. */
  recorded: string[];
  rejected: { workerId: string; file: string; reason: string }[];
}

/**
 * A container worker records into `<workerDir>/out/receipts`, the one directory it can write. The host makes each of those the
 * run's own receipt: it reads the file without following a symlink, checks it as a receipt, checks that the files it names are
 * the worker's own, and stores a new file of its own under the same exclusive-link rules. It never links the worker's file, whose
 * inode the worker could keep rewriting. Idempotent: a receipt stored on an earlier pass is a no-op, and an id already recorded
 * with different content is rejected, so a worker cannot replace a receipt.
 */
export function ingestContainerReceipts(runRoot: string, runId: RunId): IngestedReceipts {
  const result: IngestedReceipts = { recorded: [], rejected: [] };
  const workers = join(runRoot, 'workers');
  if (!existsSync(workers)) return result;
  for (const workerId of readdirSync(workers)) {
    const workerDir = join(workers, workerId);
    const out = join(workerDir, 'out');
    const inbox = join(out, 'receipts');
    const inboxStat = lstatSync(inbox, { throwIfNoEntry: false });
    if (inboxStat === undefined || !inboxStat.isDirectory()) continue;
    for (const file of readdirSync(inbox).filter((name) => RECEIPT_FILE.test(name))) {
      const reject = (reason: string) => result.rejected.push({ workerId, file, reason });
      try {
        const read = readFileBelow(out, `receipts/${file}`);
        if (read.kind !== 'ok') {
          reject(read.kind === 'missing' ? 'the file disappeared' : read.reason);
          continue;
        }
        const raw = JSON.parse(read.bytes.toString('utf8')) as { receipt?: unknown };
        const receipt = parseReceipt(raw.receipt, runId);
        if (`${receipt.id}.json` !== file) throw new Error(`receipt id ${receipt.id} does not match its file name`);
        for (const artifact of receipt.artifacts) {
          const named = artifactPath(runRoot, artifact.path);
          if (relative(workerDir, named).startsWith('..') || isAbsolute(relative(workerDir, named))) throw new Error(`artifact ${artifact.path} is not in the worker's own directory`);
        }
        result.recorded.push(storeReceipt(hostScope(runRoot), runId, receipt, join(inbox, file)).receipt.id);
      } catch (error) {
        reject(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return result;
}

/** Hashes a regular file without following a symlink at its end or waiting on a pipe: a worker chooses what its artifact paths name. */
function sha256(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('not a regular file');
    return createHash('sha256').update(readFileSync(fd)).digest('hex');
  } finally {
    closeSync(fd);
  }
}

/** Re-checks every recorded receipt for `target`: a TODO step id, a worker id, or a commit. */
export function verifyTarget(runRoot: string | EvidenceScope, runId: RunId, target: string): EvidenceVerdict {
  const { base, root } = scopeOf(runRoot);
  const { receipts, rejected } = readAll(runRoot, runId);
  const matching = receipts.filter((entry) => entry.receipt.target === target);
  const ids = matching.map((entry) => entry.receipt.id);
  if (matching.length === 0) return { kind: 'inconclusive', reason: `No receipt recorded for ${target}${rejected.length === 0 ? '' : `; container receipts rejected: ${describeRejected(rejected)}`}`, receipts: [] };
  const defects: string[] = [];
  const unverifiable: string[] = [];
  for (const { receipt } of matching) {
    if (COMMIT.test(target) && receipt.commit !== target) defects.push(`${receipt.id}: examined commit ${receipt.commit ?? '(none)'}, not ${target}`);
    for (const artifact of receipt.artifacts) {
      const path = artifactPath(base, artifact.path);
      if (!isInside(root, path)) defects.push(`${receipt.id}: artifact ${artifact.path} is outside the run`);
      else if (!existsSync(path)) defects.push(`${receipt.id}: artifact ${artifact.path} is missing`);
      else {
        let digest: string | undefined;
        try {
          digest = sha256(path);
        } catch {
          defects.push(`${receipt.id}: artifact ${artifact.path} is not a regular file`);
        }
        if (digest !== undefined && digest !== artifact.sha256) defects.push(`${receipt.id}: artifact ${artifact.path} does not match its sha256`);
      }
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

/** Inside a container worker (PSTACK_CONTAINER=1) the run root is not mounted: the worker records into its own inbox, and verifies and lists what is there. */
export function evidenceScope(cwd: string, runId: RunId, env: NodeJS.ProcessEnv = process.env): string | EvidenceScope {
  const runRoot = evidenceRunRoot(cwd, runId);
  if (env['PSTACK_CONTAINER'] !== '1') return runRoot;
  const workerDir = workerDirOf(runRoot, parseWorkerId(env['PSTACK_WORKER_ID']));
  return { base: runRoot, root: workerDir, receipts: join(workerDir, 'receipts') };
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
      const scope = evidenceScope(ctx.cwd, runId);
      const where = typeof scope === 'string' ? scope : scope.root;
      if (!existsSync(where)) throw new Error(`Run ${runId} does not exist at ${where}`);
      if (params.action === 'record') {
        if (params.receiptPath === undefined) throw new Error('receiptPath is required');
        const recorded = recordReceipt(scope, runId, params.receiptPath);
        const pending = typeof scope === 'string' ? '' : ' The parent takes it into the run when it next reads the receipts.';
        return text(`Recorded receipt ${recorded.receipt.id} for ${recorded.receipt.target} (${recorded.receipt.verdict}).${pending}`, recorded);
      }
      if (params.action === 'verify') {
        if (params.target === undefined || params.target === '') throw new Error('target is required');
        const verdict = verifyTarget(scope, runId, params.target);
        const detail = verdict.kind === 'fail' ? `\n${verdict.defects.join('\n')}` : verdict.kind === 'inconclusive' ? `\n${verdict.reason}` : '';
        return text(`${params.target}: ${verdict.kind}${detail}`, verdict);
      }
      const { receipts, rejected } = readAll(scope, runId);
      const lines = receipts.map(({ receipt }) => `${receipt.id} ${receipt.target} ${receipt.kind} ${receipt.verdict}`);
      if (rejected.length > 0) lines.push(`Rejected container receipts: ${describeRejected(rejected)}`);
      return text(lines.length === 0 ? 'No receipts recorded.' : lines.join('\n'), { receipts, rejected });
    },
  });
}
