import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { childIdentity } from './child-env.ts';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
export const AGENTS_DIR = join(PACKAGE_ROOT, 'agents');

/** Pi-owned state for this package. Follows PI_CODING_AGENT_DIR, so tests and users can relocate it. */
export function stateDir(): string {
  return join(getAgentDir(), 'pstack');
}

/** The model rule: pstack's per-role model choices, added to every request's system prompt. */
export function rulePath(): string {
  return join(stateDir(), 'pstack-models.md');
}

/** Webhook routines' sender keys, one `<slug>/credentials.json` each. */
export function routinesDir(): string {
  return join(stateDir(), 'routines');
}

/** Desired-state registry and supervisor runtime for one workspace. */
export function durableDir(cwd: string): string {
  return join(stateDir(), 'durable', workspaceSlug(cwd));
}

export function durableRegistryPath(cwd: string): string {
  return join(durableDir(cwd), 'subscriptions.json');
}

export function durableRuntimeDir(cwd: string): string {
  return join(durableDir(cwd), 'runtime');
}

/**
 * Pi's rule for a session folder name, so per-workspace state lines up with `<agentDir>/sessions/<slug>`. The live
 * `sessionManager.getSessionDir()` needs a session and names the current one, which is `<workspace>/subagents` in a
 * subagent, so the rule stays here for a working directory (docs/native-gaps.md).
 */
export function workspaceSlug(cwd: string): string {
  return `--${resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`;
}

/**
 * State for one working directory, so transcripts and stores never cross workspaces (pstack's own rule). A subagent
 * uses its main chat's, so an isolated worker in its own worktree shares the tree's Projects, records, and transcripts.
 */
export function workspaceStateDir(cwd: string, inherited: string | undefined = childIdentity.workspaceState): string {
  return inherited ?? join(stateDir(), 'workspaces', workspaceSlug(cwd));
}

/** Subagent transcripts, records, and run locks for this workspace. */
export function subagentDir(cwd: string): string {
  return join(workspaceStateDir(cwd), 'subagents');
}

/** Projects of this workspace: `<slug>/notes.md` is a project's tracker and `<slug>/store/` its store. */
export function projectsDir(cwd: string): string {
  return join(workspaceStateDir(cwd), 'projects');
}

/** Files a session's tools produce for the user, such as visualize's SVG charts. */
export function artifactsDir(cwd: string, sessionId: string): string {
  return join(workspaceStateDir(cwd), 'artifacts', sessionId);
}

export function worktreesDir(cwd: string): string {
  return join(workspaceStateDir(cwd), 'worktrees');
}

/** The store of the main chat that started this subagent tree, which autopilot owners write their trails into. */
export function rootStoreDir(cwd: string, sessionId: string, inherited: string | undefined): string {
  return inherited ?? storeDir(cwd, sessionId);
}

/** "The current agent's store" that orchestrate's store layout writes into: one directory per session. */
export function storeDir(cwd: string, sessionId: string): string {
  return join(workspaceStateDir(cwd), 'store', sessionId);
}
