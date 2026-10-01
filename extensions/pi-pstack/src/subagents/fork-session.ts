import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { TaskRecord } from '../worker-records.ts';
import type { AgentLaunch } from '../worker-support.ts';
import { type ForkSeed, type ForkState, isForkDefinition, readForkState } from './fork-context.ts';
import { ResumeError } from './resume-errors.ts';

export type ForkPlan = Readonly<{ state: ForkState; seed?: ForkSeed }>;

export const forkResumeMessage = (id: string) => `Cannot resume fork ${id}: the parent's rendered system prompt was not recorded in its transcript and cannot be reconstructed.`;

export function planFork(input: { id: string; prior: TaskRecord | undefined; launch: AgentLaunch | undefined }): ForkPlan | undefined {
  const { id, prior, launch } = input;
  if (!isForkDefinition(launch?.definition)) return undefined;
  if (prior) {
    const state = readForkState(SessionManager.open(prior.sessionFile).getEntries());
    if (!state) throw new ResumeError('state', forkResumeMessage(id));
    return { state };
  }
  if (!launch?.fork) throw new Error('Fork cannot start without the parent conversation and system prompt.');
  return { state: launch.fork.state, seed: launch.fork };
}
