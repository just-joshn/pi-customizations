import { SessionManager } from '@earendil-works/pi-coding-agent';
import { type AgentEnvironment, environmentEntryType } from './agent-storage.ts';

type Entry = ReturnType<SessionManager['getBranch']>[number];

export type SidechainRecord = AgentEnvironment & Readonly<{ uuid: string; parentUuid: string | null; timestamp: string; type: string; message?: unknown }>;

function isEnvironment(data: unknown): data is AgentEnvironment {
  if (typeof data !== 'object' || data === null) return false;
  const value = data as Record<string, unknown>;
  return typeof value.agentId === 'string' && typeof value.sessionId === 'string' && typeof value.cwd === 'string' && typeof value.version === 'string' && typeof value.gitBranch === 'string';
}

function recordType(entry: Entry): string {
  if (entry.type !== 'message') return entry.type;
  return entry.message.role === 'assistant' ? 'assistant' : 'user';
}

/** Projects a pi branch into Claude-shaped sidechain records, following parentId ancestry from the leaf. */
export function sidechainRecords(branch: readonly Entry[]): SidechainRecord[] {
  const marker = branch.find((entry) => entry.type === 'custom' && entry.customType === environmentEntryType);
  const environment = marker?.type === 'custom' && isEnvironment(marker.data) ? marker.data : undefined;
  if (!environment) return [];
  return branch.map((entry) => ({
    ...environment,
    uuid: entry.id,
    parentUuid: entry.parentId,
    timestamp: entry.timestamp,
    type: recordType(entry),
    ...(entry.type === 'message' ? { message: entry.message } : {}),
  }));
}

export function readSidechain(path: string): SidechainRecord[] {
  return sidechainRecords(SessionManager.open(path).getBranch());
}
