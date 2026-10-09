import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Two-step lifecycle. Idempotent: step-1 is overwritten, never read back, so a
 * re-run after a mid-crash converges to the same final state.
 */
export async function apply(root, { crashAfter } = {}) {
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const step1Path = join(stateDir, 'step-1.json');

  const run = 1;

  await writeFile(step1Path, `${JSON.stringify({ phase: 'step-1', run })}\n`);

  if (crashAfter === 1) {
    const err = new Error('CRASH_AFTER_STEP_1');
    err.code = 'CRASH_AFTER_STEP_1';
    throw err;
  }

  const final = { status: 'ready', run, payload: 'DEPLOYED' };
  await writeFile(join(stateDir, 'final.json'), `${JSON.stringify(final)}\n`);
  return final;
}
