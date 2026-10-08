import { randomUUID } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startAttempt } from './attempt.mjs';
import { outputBytes } from './fold.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SIDES = ['cursor', 'pi'];

async function waitForOutput(attempt, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!Buffer.from(outputBytes(attempt.events())).toString('latin1').includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for output "${needle}"`);
    await sleep(20);
  }
}

async function runStep(attempt, step) {
  if (step.waitFor !== undefined) await waitForOutput(attempt, step.waitFor, step.timeoutMs ?? 10000);
  if (step.resize) attempt.resize(step.resize);
  if (step.send !== undefined) attempt.input(Buffer.from(step.send), step.origin ?? 'literal_user');
  if (step.cancel) await attempt.cancel();
}

async function recordSide(root, spec, steps) {
  await mkdir(root);
  const attempt = await startAttempt({ ...spec, root });
  try {
    for (const step of steps) await runStep(attempt, step);
  } catch (error) {
    await attempt.cancel();
    await attempt.done();
    throw error;
  }
  const log = await attempt.done();
  return { attemptId: attempt.id, dir: attempt.dir, executable: log.identity.executable, observedEnv: log.identity.observedEnv };
}

export async function recordPair({ root, scenarioRef, steps, cursor, pi }) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Pair root must be a real directory: ${root}`);
  const specs = { cursor, pi };
  const digests = SIDES.map((side) => specs[side].fixtureRef?.digest ?? null);
  if (digests[0] !== digests[1]) throw new Error(`Pair refused, fixture digest differs: ${digests.join(' vs ')}`);
  const pairId = randomUUID();
  const dir = join(root, `pair-${pairId}`);
  await mkdir(dir);
  const sides = {};
  try {
    for (const side of SIDES) sides[side] = await recordSide(join(dir, side), specs[side], steps);
  } catch (error) {
    const failure = { schema: 1, pairId, scenarioRef, error: error.message, recordedSides: Object.keys(sides) };
    await writeFile(join(dir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`, { flag: 'wx' });
    throw error;
  }
  const record = { schema: 1, pairId, scenarioRef, fixtureDigest: digests[0], steps, ...sides };
  await writeFile(join(dir, 'pair.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return { dir, ...record };
}
