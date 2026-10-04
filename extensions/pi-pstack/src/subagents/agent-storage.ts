import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { SessionManager, VERSION } from '@earendil-works/pi-coding-agent';
import type { Exec } from './environment-facts.ts';
import { validateId } from './identifiers.ts';

export type AgentMeta = Readonly<{
  agentType: string;
  description: string;
  toolUseId?: string;
  spawnDepth: number;
  requestShape: 'foreground' | 'background';
  requestNonInteractive: boolean;
}>;

export type AgentEnvironment = Readonly<{ agentId: string; isSidechain: true; sessionId: string; cwd: string; version: string; gitBranch: string }>;

export const environmentEntryType = 'pstack-agent-environment';

export function childStorageDir(sessionDir: string, parentSessionId: string): string {
  return resolve(sessionDir, validateId(parentSessionId), 'subagents');
}

export function agentTranscriptPath(dir: string, agentId: string): string {
  return join(dir, `agent-${validateId(agentId)}.jsonl`);
}

export function agentMetaPath(dir: string, agentId: string): string {
  return join(dir, `agent-${validateId(agentId)}.meta.json`);
}

/** Pi's setSessionFile accepts a chosen path but resets the parent header and defers missing-file creation. Keep only the exclusive eager write here; Pi owns the header and subsequent session state. */
export async function createChildTranscript(cwd: string, dir: string, agentId: string, parentSession: string | undefined): Promise<string> {
  const path = agentTranscriptPath(dir, agentId);
  await mkdir(dir, { recursive: true });
  const header = SessionManager.create(cwd, dir, { ...(parentSession ? { parentSession } : {}) }).getHeader();
  await writeFile(path, `${JSON.stringify(header)}\n`, { flag: 'wx' });
  return path;
}

export async function writeAgentMeta(dir: string, agentId: string, meta: AgentMeta): Promise<void> {
  const path = agentMetaPath(dir, agentId);
  if (!existsSync(path)) await writeFile(path, JSON.stringify(meta));
}

async function gitBranch(exec: Exec, cwd: string): Promise<string> {
  const result = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).catch(() => undefined);
  return (result?.code === 0 && result.stdout.trim()) || 'HEAD';
}

export async function agentEnvironment(agentId: string, parentSessionId: string, cwd: string, exec: Exec): Promise<AgentEnvironment> {
  return { agentId, isSidechain: true, sessionId: parentSessionId, cwd, version: VERSION, gitBranch: await gitBranch(exec, cwd) };
}
