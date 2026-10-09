import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Two-step lifecycle. Intentionally non-idempotent: leftover step-1 bumps `run`,
 * so a re-run after a mid-crash changes the final payload.
 */
export async function apply(root, { crashAfter } = {}) {
  const stateDir = join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const step1Path = join(stateDir, 'step-1.json');

  let run = 1;
  try {
    const prev = JSON.parse(await readFile(step1Path, 'utf8'));
    if (typeof prev.run === 'number') run = prev.run + 1;
  } catch {
    // first run
  }

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
