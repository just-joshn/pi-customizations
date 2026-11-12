// Stops an automation run's worker the way `pstack_worker abort` does: the host's `shutdown` operation, which clears
// queued work, aborts, and closes. A host that cannot be reached has nothing to stop.
import { join } from 'node:path';

import { HostUnavailableError, controlHost, hostTarget } from '../rpc-client.ts';
import { loadAssignment } from '../run-files.ts';
import { workerDir } from './dispatch.ts';
import type { RunId } from './model.ts';

export type AbortOutcome = 'aborted' | 'unreachable';

export type AbortRun = (projectRoot: string, runId: RunId) => Promise<AbortOutcome>;

export const abortRun: AbortRun = async (projectRoot, runId) => {
  const loaded = loadAssignment(join(workerDir(projectRoot, runId), 'assignment.json'));
  try {
    await controlHost(hostTarget(loaded), 'shutdown');
    return 'aborted';
  } catch (error) {
    if (error instanceof HostUnavailableError) return 'unreachable';
    throw error;
  }
};
