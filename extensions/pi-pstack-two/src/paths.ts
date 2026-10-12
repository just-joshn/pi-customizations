import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAgentDir } from '@earendil-works/pi-coding-agent';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
export const AGENTS_DIR = join(PACKAGE_ROOT, 'agents');

/** Pi-owned state for this package. Follows PI_CODING_AGENT_DIR, so tests and users can relocate it. */
export function stateDir(): string {
  return join(getAgentDir(), 'pstack-two');
}

/** Pi home of the rule that Cursor keeps at ~/.cursor/rules/pstack-models.mdc. */
export function rulePath(): string {
  return join(stateDir(), 'pstack-models.mdc');
}

/** Pi's rule for a session folder name, so per-workspace state lines up with `<agentDir>/sessions/<slug>`. */
export function workspaceSlug(cwd: string): string {
  return `--${resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`;
}

/** State for one working directory, so transcripts and stores never cross workspaces (pstack's own rule). */
export function workspaceStateDir(cwd: string): string {
  return join(stateDir(), 'workspaces', workspaceSlug(cwd));
}

/** Subagent transcripts, records, and run locks for this workspace; Cursor's equivalent is ~/.cursor/subagents/. */
export function subagentDir(cwd: string): string {
  return join(workspaceStateDir(cwd), 'subagents');
}

/** "The current agent's store" that orchestrate's store layout writes into: one directory per session. */
export function storeDir(cwd: string, sessionId: string): string {
  return join(workspaceStateDir(cwd), 'store', sessionId);
}
