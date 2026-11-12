// What the parent checks before it accepts a repro outcome. Upstream's repro skill makes the exact symptom appear twice
// through the real UI before any fix (reproduce SKILL.md:25, 126-134), makes a fix show the symptom twice on a baseline and
// its absence twice on the patched build (SKILL.md:218-225, references/verify-existing-fix.md), and makes an existing fix
// get verified rather than competed with (FOR_AGENTS.md:19). Whether a worker really drove a real UI is not something the
// parent can see. What it can see, and what a worker that did the work cannot help leaving behind, is a record: each
// observation a timestamp and its own capture in the run's artifact folder. The worker writes `repro.json` there:
//
//   { "reproductions": [ { "at": <ISO time>, "artifact": <file>, "state": <the broken final state seen> }, ... ],
//     "existingFix":   { "url": <github pull or commit url>, "outcome": "confirmed" | "insufficient" | "inconclusive",
//                        "baseline": [ <run>, ... ], "patched": [ <run>, ... ] },
//     "fix":           { "patched": [ <run>, ... ] } }
//
// A set of runs counts when at least two of them have a parseable timestamp after the case (or turn) started and not in the
// future, an artifact that is a regular screenshot, recording or note inside the run's own folder, written after the case
// started, and a non-empty state, with strictly increasing timestamps and different bytes, so one capture is never
// presented twice. Everything here is a read of data a worker wrote, so it validates and never trusts, and a missing or
// unusable record is a failed check: the parent fails closed. What stays unproven is that the capture came from a real UI
// and shows the symptom, which only a live application can establish (see the BENNY-REPRODUCE-TWICE coverage gap).
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { extname, join } from 'node:path';

import { artifactDirOf, insideRunFolder, readRegular, TYPES } from './evidence-files.ts';

export const PROOF_FILE = 'repro.json';
export const RUNS_REQUIRED = 2;
/** A worker's clock and the parent's are one machine's, so a timestamp may lead the parent's by this much and no more. */
const SKEW_MS = 60_000;
const MAX_RUNS = 20;
const MAX_FILE_BYTES = 50 * 1024 ** 2;
const GITHUB_FIX = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:pull\/[1-9]\d{0,9}|commit\/[0-9a-f]{7,40})$/;

interface Run {
  at: number;
  artifact: string;
  state: string;
}
export interface ProofContext {
  /** `control.artifact_directory`. Without one nothing can be checked. */
  artifactDirectory: string | undefined;
  runId: string;
  /** Observations older than this belong to an earlier turn or to another case. */
  since: Date;
  now: Date;
}
export type Verdict = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Verdict => ({ ok: false, reason });

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : undefined);

function readRecord(ctx: ProofContext): { proof: Raw } | { problem: string } {
  if (ctx.artifactDirectory === undefined) return { problem: 'the configuration names no artifact directory, so there is nowhere to read the proof record from' };
  const file = join(artifactDirOf(ctx.artifactDirectory, ctx.runId), PROOF_FILE);
  if (!existsSync(file) || !lstatSync(file).isFile()) return { problem: `there is no proof record (${PROOF_FILE}) in the run's artifact directory` };
  try {
    const proof = record(JSON.parse(readRegular(file, 1024 ** 2).toString('utf8')));
    return proof === undefined ? { problem: `the proof record ${PROOF_FILE} is not a JSON object` } : { proof };
  } catch {
    return { problem: `the proof record ${PROOF_FILE} is not valid JSON` };
  }
}

/** One group of runs: the first problem found, or ok when at least two distinct, ordered, captured observations stand. */
function checkRuns(value: unknown, label: string, ctx: ProofContext, after = ctx.since): Verdict {
  const raw = Array.isArray(value) ? value.slice(0, MAX_RUNS) : [];
  if (raw.length === 0) return fail(`the proof record lists no ${label}`);
  const base = artifactDirOf(ctx.artifactDirectory ?? '', ctx.runId);
  const problems: string[] = [];
  const accepted: { run: Run; digest: string }[] = [];
  for (const [index, entry] of raw.entries()) {
    const own = (reason: string) => problems.push(`${label} ${index + 1} ${reason}`);
    const fields = record(entry);
    const at = typeof fields?.['at'] === 'string' ? Date.parse(fields['at']) : Number.NaN;
    const artifact = fields?.['artifact'];
    const state = fields?.['state'];
    if (Number.isNaN(at)) own('has no usable timestamp');
    else if (at < after.getTime()) own('is timestamped before the work it proves started');
    else if (at > ctx.now.getTime() + SKEW_MS) own('is timestamped in the future');
    else if (typeof state !== 'string' || state.trim() === '') own('names no observed state');
    else if (typeof artifact !== 'string' || TYPES[extname(artifact).toLowerCase()] === undefined) own('has no screenshot, recording or note artifact');
    else {
      const found = insideRunFolder(base, artifact);
      if ('problem' in found) own(`artifact ${found.problem}`);
      else {
        let bytes: Buffer | undefined;
        try {
          const info = lstatSync(found.real);
          if (info.mtimeMs < ctx.since.getTime() - SKEW_MS || info.mtimeMs > ctx.now.getTime() + SKEW_MS) own('artifact was not written during this case');
          else bytes = readRegular(found.real, MAX_FILE_BYTES);
        } catch {
          own('artifact cannot be read');
        }
        if (bytes !== undefined) accepted.push({ run: { at, artifact, state: state as string }, digest: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  accepted.sort((left, right) => left.run.at - right.run.at);
  const distinct = accepted.filter((item, index) => index === 0 || (item.run.at > (accepted[index - 1] as { run: Run }).run.at && !accepted.slice(0, index).some((earlier) => earlier.digest === item.digest)));
  if (distinct.length >= RUNS_REQUIRED) return { ok: true };
  const why = problems[0] ?? (accepted.length > distinct.length ? 'repeats an earlier timestamp or capture, so it is not an independent second observation' : '');
  return fail(`${label}: ${distinct.length} of ${RUNS_REQUIRED} required observations are usable${why === '' ? '' : ` (${why})`}`);
}

/** The symptom appeared twice: at least two reproductions, each with its own timestamped capture, after `since`. */
export function verifyReproduction(ctx: ProofContext): Verdict {
  const read = readRecord(ctx);
  if ('problem' in read) return fail(read.problem);
  return checkRuns(read.proof['reproductions'], 'reproductions', ctx);
}

/** The github.com link of the existing fix the record names, when it is a usable one. */
export const existingFixUrl = (ctx: ProofContext): string | undefined => {
  const read = readRecord(ctx);
  const url = 'problem' in read ? undefined : record(read.proof['existingFix'])?.['url'];
  return typeof url === 'string' && GITHUB_FIX.test(url) ? url : undefined;
};

/** Whether the record says the worker verified an existing fix. */
export const claimsExistingFix = (ctx: ProofContext): boolean => {
  const read = readRecord(ctx);
  return !('problem' in read) && record(read.proof['existingFix']) !== undefined;
};

/**
 * An existing fix, verified: one concrete github.com pull request or commit, a baseline that reproduced twice, and a
 * patched build measured twice after it, with the outcome the worker reports matching the one it is accepted as.
 */
export function verifyExistingFix(ctx: ProofContext, outcome: 'confirmed' | 'insufficient'): Verdict {
  const read = readRecord(ctx);
  if ('problem' in read) return fail(read.problem);
  const fix = record(read.proof['existingFix']);
  if (fix === undefined) return fail('the proof record has no existingFix section');
  if (typeof fix['url'] !== 'string' || !GITHUB_FIX.test(fix['url'])) return fail('existingFix.url is not a github.com pull request or commit link');
  if (fix['outcome'] !== outcome) return fail(`existingFix.outcome is ${JSON.stringify(fix['outcome'])}, not ${JSON.stringify(outcome)}`);
  const baseline = checkRuns(fix['baseline'], 'baseline runs', ctx);
  if (!baseline.ok) return baseline;
  const times = (Array.isArray(fix['baseline']) ? fix['baseline'] : []).flatMap((entry) => (typeof record(entry)?.['at'] === 'string' ? [Date.parse(record(entry)?.['at'] as string)] : [])).filter((time) => !Number.isNaN(time) && time <= ctx.now.getTime() + SKEW_MS);
  return checkRuns(fix['patched'], 'patched runs', ctx, new Date(Math.max(ctx.since.getTime(), ...times)));
}

/** A fix that is ready for a draft pull request: the patched build measured twice after the fix turn started. */
export function verifyPatched(ctx: ProofContext): Verdict {
  const read = readRecord(ctx);
  if ('problem' in read) return fail(read.problem);
  return checkRuns(record(read.proof['fix'])?.['patched'], 'patched runs', ctx);
}
