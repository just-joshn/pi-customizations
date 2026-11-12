// The parent's acceptance of a repro worker's reported outcome (see proof.ts for what a record must show). A worker that
// reports `Reproduced` or `Verifying existing fix` without the proof is not believed: its outcome becomes the honest
// one, the parent says so in the operations thread, and nothing it claimed reaches the source thread.
import { claimsExistingFix, existingFixUrl, type ProofContext, type Verdict, verifyExistingFix, verifyReproduction } from './proof.ts';
import type { OpsStatus, WorkerResult } from './model.ts';

export const NOT_CONFIRMED: OpsStatus = 'Could not reproduce';
/** Where the check of an existing fix ended without a verdict. Not `Blocked`, which is for an environment that prevents the attempt, and not `Could not reproduce`, which is for a completed reproduction. */
export const NOT_VERIFIED: OpsStatus = 'Verification incomplete';
/** Where the check of an existing fix ended with the symptom still on the patched build. */
export const NOT_FIXED: OpsStatus = 'Reproduced but not fixed';

/** What the operations thread says when the parent did not accept a reported outcome. */
export const unverifiedNote = (reported: string | undefined, recorded: OpsStatus, reason: string) => `The parent could not verify the evidence behind the reported ${reported ?? 'outcome'}: ${reason}. It is recorded as ${recorded}, and nothing was posted in the source thread.`;

const withoutClaim = (result: WorkerResult, status: OpsStatus, reason: string): WorkerResult => {
  const { evidence: _evidence, ...rest } = result;
  return { ...rest, text: '', status, operations: unverifiedNote(result.status, status, reason) };
};

/**
 * The outcome the parent accepts for `result`. `Reproduced` needs two timestamped reproductions, or for a worker that
 * also verified an existing fix, a record showing that fix did not resolve it. `Verifying existing fix` needs the full
 * baseline and patched record. When the check of an existing fix cannot be shown to have finished, the outcome is
 * `Verification incomplete`, never `Could not reproduce` (which says a reproduction finished) and never `Blocked` (which
 * says the environment prevented the attempt). A verified fix that does not fix it shows as `Reproduced but not fixed`.
 * The worker's own `Verification incomplete` makes no claim to refute, and posts nothing in the source thread. Every other
 * status makes no claim this check could refute.
 */
export function acceptOutcome(result: WorkerResult, ctx: ProofContext): { result: WorkerResult; existingFix?: boolean; unverified?: string; shown?: OpsStatus } {
  const reported = result.status === NOT_FIXED ? 'Reproduced' : result.status;
  if (reported === 'Reproduced') {
    const existing = claimsExistingFix(ctx);
    const verdict: Verdict = existing ? verifyExistingFix(ctx, 'insufficient') : verifyReproduction(ctx);
    if (!verdict.ok) return { result: withoutClaim(result, existing ? NOT_VERIFIED : NOT_CONFIRMED, verdict.reason), ...(existing ? { existingFix: true } : {}), unverified: verdict.reason };
    if (!existing) return { result: { ...result, status: 'Reproduced' } };
    const url = existingFixUrl(ctx);
    const note = `Reproduced but not fixed: ${url ?? 'the existing fix'} did not resolve the symptom, which appeared on both the baseline and the patched build.`;
    return { result: { ...result, status: 'Reproduced', operations: [note, result.operations ?? ''].filter((part) => part !== '').join('\n') }, existingFix: true, shown: NOT_FIXED };
  }
  if (reported === 'Verifying existing fix') {
    const verdict = verifyExistingFix(ctx, 'confirmed');
    return verdict.ok ? { result, existingFix: true } : { result: withoutClaim(result, NOT_VERIFIED, verdict.reason), existingFix: true, unverified: verdict.reason };
  }
  if (reported === NOT_VERIFIED) return { result: { ...result, text: '' }, existingFix: true };
  return { result };
}
