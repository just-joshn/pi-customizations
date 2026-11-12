// Stops an automation run's worker through the runtime's own abort (`abortWorker` in src/workers.ts, the code behind
// `pstack_worker abort`): the host's `shutdown`, and for a host that cannot be reached, ending its claimed tmux session or
// abandoning a claim no host ever took.
import { join } from 'node:path';

import { loadAssignment } from '../run-files.ts';
import { abortWorker, type Exec } from '../workers.ts';
import { workerDir } from './dispatch.ts';
import type { RunId } from './model.ts';

/** The receipt's disposition: `stopped`, `session-ended`, `abandoned`, or `refused: <why>` when nothing could be ended. */
export type AbortOutcome = string;

export type AbortRun = (projectRoot: string, runId: RunId) => Promise<AbortOutcome>;

export const abortInTmux =
  (options: { exec?: Exec; tmuxSocket?: string; startCheckMs?: number } = {}): AbortRun =>
  async (projectRoot, runId) => {
    const loaded = loadAssignment(join(workerDir(projectRoot, runId), 'assignment.json'));
    const receipt = (await abortWorker(projectRoot, loaded, options)) as { disposition?: unknown; reason?: unknown } | null;
    const disposition = typeof receipt?.disposition === 'string' ? receipt.disposition : 'stopped';
    return disposition === 'refused' && typeof receipt?.reason === 'string' ? `refused: ${receipt.reason}` : disposition;
  };

export const abortRun: AbortRun = abortInTmux();
