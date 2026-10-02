import { foldAgentType, forkType } from './fork-gate.ts';
import type { AdmissionSnapshot, Refusal, SpawnRequest } from './types.ts';

export function forkRequest(snapshot: AdmissionSnapshot, requested: string): { type: string } | { refusal: Refusal } | undefined {
  if (foldAgentType(requested) !== forkType) return undefined;
  if (snapshot.forkDenial) {
    const { rule, source } = snapshot.forkDenial;
    return { refusal: { code: 'subagent_type_denied', message: `Agent type '${forkType}' has been denied by permission rule '${rule}' from ${source}.` } };
  }
  return snapshot.forkAvailable ? { type: forkType } : undefined;
}

export function forkRefusal(snapshot: AdmissionSnapshot, request: SpawnRequest): Refusal | undefined {
  if (request.isolation === 'remote')
    return {
      code: 'subagent_fork_remote_isolation',
      message: 'Fork cannot use isolation: "remote" — a remote session cannot inherit the conversation context. Omit isolation (or use "worktree"), or spawn a named agent type for remote work.',
    };
  if (snapshot.insideFork) return { code: 'subagent_recursive_fork', message: 'Fork is not available inside a forked worker. Complete your task directly using your tools.' };
  return undefined;
}
