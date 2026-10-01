import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { SessionManager, VERSION } from '@earendil-works/pi-coding-agent';
import { validateId } from './identifiers.ts';

const run = promisify(execFile);

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

/** Pi names session files itself, so the header is written here to pin the agent-<id>.jsonl name and the parent link. */
export async function createChildTranscript(cwd: string, dir: string, agentId: string, parentSession: string | undefined): Promise<string> {
  const path = agentTranscriptPath(dir, agentId);
  await mkdir(dir, { recursive: true });
  const header = SessionManager.create(cwd, dir, { id: agentId, ...(parentSession ? { parentSession } : {}) }).getHeader();
  await writeFile(path, `${JSON.stringify(header)}\n`, { flag: 'wx' });
  return path;
}

export async function writeAgentMeta(dir: string, agentId: string, meta: AgentMeta): Promise<void> {
  const path = agentMetaPath(dir, agentId);
  if (!existsSync(path)) await writeFile(path, JSON.stringify(meta));
}

async function gitBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return stdout.trim() || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

export async function agentEnvironment(agentId: string, parentSessionId: string, cwd: string): Promise<AgentEnvironment> {
  return { agentId, isSidechain: true, sessionId: parentSessionId, cwd, version: VERSION, gitBranch: await gitBranch(cwd) };
}
