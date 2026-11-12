// Sends a running worker its next message the way `pstack_worker steer` does: the host's `steer` operation, which a host
// takes as the worker's next prompt while it is idle.
import { join } from 'node:path';

import { controlHost, hostTarget } from '../rpc-client.ts';
import { loadAssignment } from '../run-files.ts';
import { workerDir } from './dispatch.ts';
import type { RunId } from './model.ts';

export type SteerRun = (projectRoot: string, runId: RunId, text: string) => Promise<void>;

export const steerRun: SteerRun = async (projectRoot, runId, text) => {
  await controlHost(hostTarget(loadAssignment(join(workerDir(projectRoot, runId), 'assignment.json'))), 'steer', text);
};
