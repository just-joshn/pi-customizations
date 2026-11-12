// Before a real run builds anything, one tiny request to each model the run will use. A provider that is out of quota or has no credential is found here, once, not 78 times.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REAL_MODEL, REAL_MODEL_B, runWorkflow } from './driver.ts';

export interface ModelCheck {
  model: string;
  ok: boolean;
  /** The provider's error text, or why the reply was not the expected one. */
  detail: string;
  line: string;
}

export const modelsInUse = (): string[] => [...new Set([REAL_MODEL, REAL_MODEL_B].filter((model) => model !== ''))];

/** One prompt on `model` in a fresh sandbox. Not ok means the model cannot be called: nothing built on it is evidence. */
export async function checkModel(model: string): Promise<ModelCheck> {
  const outcome = await runWorkflow({ family: 'model-check', runId: 'model-check', mode: 'print', timeoutMs: 120_000, roles: {}, history: [{ message: 'init', files: { 'README.md': 'x\n' } }], prompt: () => 'Reply with exactly the word pong and nothing else. Do not use tools.', scenario: () => ({ actors: {} }) }, 'real', { model });
  const oneShot = JSON.parse(readFileSync(join(outcome.sandbox, 'one-shot.json'), 'utf8')) as { exitCode: number | null; stdout: string; stderr: string };
  const sessionError = outcome.view.parent.errors[0];
  outcome.cleanup();
  const ponged = oneShot.exitCode === 0 && /pong/i.test(oneShot.stdout);
  const detail = ponged ? '' : (sessionError ?? (oneShot.stderr.trim().slice(-400) || `exit ${oneShot.exitCode}, stdout ${JSON.stringify(oneShot.stdout.trim().slice(0, 200))}`));
  const line = `${model} in a sandbox: exit ${oneShot.exitCode}, stdout ${JSON.stringify(oneShot.stdout.trim())}${oneShot.stderr === '' ? '' : `, stderr ${JSON.stringify(oneShot.stderr.slice(-400))}`}`;
  return { model, ok: ponged && sessionError === undefined, detail: sessionError ?? detail, line };
}
