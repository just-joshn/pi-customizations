// The parent's acceptance of a repro worker's reported outcome (see proof.ts for what a record must show). A worker that
// reports `Reproduced` or `Verifying existing fix` without the proof is not believed: its outcome becomes the honest
// one, the parent says so in the operations thread, and nothing it claimed reaches the source thread.
import { claimsExistingFix, type ProofContext, type Verdict, verifyExistingFix, verifyReproduction } from './proof.ts';
import type { OpsStatus, WorkerResult } from './model.ts';

export const NOT_CONFIRMED: OpsStatus = 'Could not reproduce';
const NOT_VERIFIED: OpsStatus = 'Blocked';

/** What the operations thread says when the parent did not accept a reported outcome. */
export const unverifiedNote = (reported: string | undefined, recorded: OpsStatus, reason: string) => `The parent could not verify the evidence behind the reported ${reported ?? 'outcome'}: ${reason}. It is recorded as ${recorded}, and nothing was posted in the source thread.`;

const withoutClaim = (result: WorkerResult, status: OpsStatus, reason: string): WorkerResult => {
  const { evidence: _evidence, ...rest } = result;
  return { ...rest, text: '', status, operations: unverifiedNote(result.status, status, reason) };
};

/**
 * The outcome the parent accepts for `result`. `Reproduced` needs two timestamped reproductions, or for a worker that
 * also verified an existing fix, a record showing that fix did not resolve it. `Verifying existing fix` needs the full
 * baseline and patched record. Every other status makes no claim this check could refute.
 */
export function acceptOutcome(result: WorkerResult, ctx: ProofContext): { result: WorkerResult; existingFix?: boolean; unverified?: string } {
  if (result.status === 'Reproduced') {
    const existing = claimsExistingFix(ctx);
    const verdict: Verdict = existing ? verifyExistingFix(ctx, 'insufficient') : verifyReproduction(ctx);
    return verdict.ok ? { result, ...(existing ? { existingFix: true } : {}) } : { result: withoutClaim(result, NOT_CONFIRMED, verdict.reason), unverified: verdict.reason };
  }
  if (result.status === 'Verifying existing fix') {
    const verdict = verifyExistingFix(ctx, 'confirmed');
    return verdict.ok ? { result, existingFix: true } : { result: withoutClaim(result, NOT_VERIFIED, verdict.reason), unverified: verdict.reason };
  }
  return { result };
}
