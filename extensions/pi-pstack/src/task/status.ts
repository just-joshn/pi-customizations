import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { subagentDir } from '../paths.ts';
import type { ModelSpec } from './models.ts';
import { readRecord, recordIds, runningPid, transcriptFor } from './records.ts';
import { validateAgentId } from './runner.ts';

const LIST_LIMIT = 20;
const TEXT_LIMIT = 500;
const FIRST_READ_BYTES = 64 * 1024;
// A transcript can grow to hundreds of megabytes; status reads only its tail.
const TAIL_LIMIT_BYTES = 4 * 1024 * 1024;

export interface AgentStatus {
  agentId: string;
  state: 'running' | 'idle' | 'missing';
  pid?: number;
  type?: string;
  model?: string;
  readonly?: boolean;
  directory?: string;
  branch?: string;
  forkedFrom?: string;
  createdAt?: string;
  updatedAt?: string;
  transcript?: string;
  lastText?: string;
}

const modelName = (model: ModelSpec | undefined) => (model === undefined ? "Pi's default model" : `${model.provider}/${model.id}${model.thinking === undefined ? '' : `:${model.thinking}`}`);

function truncate(text: string): string {
  const flat = text.trim();
  return flat.length > TEXT_LIMIT ? `${flat.slice(0, TEXT_LIMIT)}…` : flat;
}

function readTail(path: string, size: number, bytes: number): string {
  const length = Math.min(size, bytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8');
}

function assistantTextOf(line: string): string | undefined {
  let entry: { type?: unknown; message?: { role?: unknown; content?: unknown } };
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (entry.type !== 'message' || entry.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) return undefined;
  const text = (entry.message.content as { type?: unknown; text?: unknown }[])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
  return text.trim() === '' ? undefined : truncate(text);
}

/** The text of the last assistant message in a Pi session file, scanning back from the end through at most its last 4 MiB. */
export function lastAssistantText(transcript: string): string | undefined {
  const { size } = statSync(transcript);
  for (let bytes = FIRST_READ_BYTES; ; bytes *= 4) {
    const lines = readTail(transcript, size, bytes).split('\n');
    // The first line of a partial read is cut off.
    if (bytes < size) lines.shift();
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const text = assistantTextOf(lines[index]?.trim() ?? '');
      if (text !== undefined) return text;
    }
    if (bytes >= size || bytes >= TAIL_LIMIT_BYTES) return undefined;
  }
}

/** One agent's state from its record, run lock, and transcript. Reads files only; never starts anything. */
export function agentStatus(dir: string, agentId: string): AgentStatus {
  const record = readRecord(dir, agentId);
  const transcript = transcriptFor(dir, agentId);
  if (record === undefined && transcript === undefined) return { agentId, state: 'missing' };
  const pid = runningPid(dir, agentId);
  const updated = transcript ?? join(dir, `${agentId}.json`);
  const lastText = transcript === undefined ? undefined : lastAssistantText(transcript);
  return {
    agentId,
    state: pid === undefined ? 'idle' : 'running',
    ...(pid === undefined ? {} : { pid }),
    ...(record === undefined
      ? {}
      : {
          type: record.type,
          model: modelName(record.model),
          readonly: record.readonly,
          directory: record.worktree?.cwd ?? record.cwd,
          createdAt: record.createdAt,
          ...(record.worktree === undefined ? {} : { branch: record.worktree.branch }),
          ...(record.forkedFrom === undefined ? {} : { forkedFrom: record.forkedFrom }),
        }),
    ...(existsSync(updated) ? { updatedAt: statSync(updated).mtime.toISOString() } : {}),
    ...(transcript === undefined ? {} : { transcript }),
    ...(lastText === undefined ? {} : { lastText }),
  };
}

/** Agents with a record in `dir`, newest first, at most `limit`, and how many there are in all. */
export function listAgentStatuses(dir: string, limit: number = LIST_LIMIT): { agents: AgentStatus[]; total: number } {
  const records = recordIds(dir).flatMap((agentId) => {
    try {
      const record = readRecord(dir, agentId);
      return record === undefined ? [] : [record];
    } catch {
      return [];
    }
  });
  const newest = records.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
  return { agents: newest.map((record) => agentStatus(dir, record.agentId)), total: records.length };
}

export function statusText(status: AgentStatus): string {
  if (status.state === 'missing') return `Agent ${status.agentId}: missing (no record or transcript in this workspace)`;
  const fields: [string, string | undefined][] = [
    ['state', status.state === 'running' ? `running (pid ${status.pid})` : 'idle'],
    ['type', status.type === undefined ? undefined : `${status.type}${status.readonly === true ? ' (readonly)' : ''}`],
    ['model', status.model],
    ['directory', status.directory],
    ['branch', status.branch],
    ['forked from', status.forkedFrom],
    ['created', status.createdAt],
    ['updated', status.updatedAt],
    ['transcript', status.transcript],
  ];
  const lines = fields.flatMap(([name, value]) => (value === undefined ? [] : [`  ${name}: ${value}`]));
  const last = status.lastText === undefined ? [] : ['  last response:', ...status.lastText.split('\n').map((line) => `    ${line}`)];
  return [`Agent ${status.agentId}`, ...lines, ...last].join('\n');
}

export const AgentStatusParams = Type.Object({
  agent_id: Type.Optional(Type.String({ description: 'Agent ID from an earlier Task call in this workspace. Omit it to list the most recent agents, newest first.' })),
});

const DESCRIPTION =
  'Read-only status of subagents in this workspace: running or idle, type, model, directory, worktree branch, created and updated times, and the last response. This is the way to check on a worker; it never starts, messages, or resumes anything. Task resume would message a running agent or restart an idle one instead.';

export function registerAgentStatus(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'agent_status',
    label: 'Agent status',
    description: DESCRIPTION,
    promptSnippet: 'Check subagents read-only (running or idle, last response) without restarting them',
    parameters: AgentStatusParams,
    annotations: { readOnlyHint: true, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dir = subagentDir(ctx.cwd);
      if (params.agent_id !== undefined) {
        const status = agentStatus(dir, validateAgentId(params.agent_id));
        return { content: [{ type: 'text', text: statusText(status) }], details: { agents: [status], total: status.state === 'missing' ? 0 : 1 } };
      }
      const { agents, total } = listAgentStatuses(dir);
      const header = total === 0 ? 'No subagents in this workspace yet.' : `${total} subagent${total === 1 ? '' : 's'} in this workspace${total > agents.length ? `; the ${agents.length} newest` : ''}:`;
      return { content: [{ type: 'text', text: [header, ...agents.map(statusText)].join('\n\n') }], details: { agents, total } };
    },
  });
}
