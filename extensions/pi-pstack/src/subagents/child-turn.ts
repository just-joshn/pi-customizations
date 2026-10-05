import type { TaskRecord } from '../worker-records.ts';
import { taskOutputLimit } from '../worker-records.ts';
import type { RpcRecord } from './rpc-child.ts';

export type TurnState = Readonly<{ toolUses: number; failure?: string; aborted: boolean }>;
export const initialTurn: TurnState = { toolUses: 0, aborted: false };

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function assistantMessage(record: RpcRecord): Record<string, unknown> | undefined {
  const message = record.type === 'message_end' ? asObject(record['message']) : undefined;
  return message?.['role'] === 'assistant' ? message : undefined;
}

export function foldTurn(state: TurnState, record: RpcRecord): TurnState {
  if (record.type === 'tool_execution_end') return { ...state, toolUses: state.toolUses + 1 };
  const message = assistantMessage(record);
  if (message?.['stopReason'] === 'aborted') return { ...state, aborted: true };
  if (message?.['stopReason'] === 'error') return { ...state, failure: typeof message['errorMessage'] === 'string' ? message['errorMessage'] : 'The model request failed.' };
  return state;
}

export function assistantText(record: RpcRecord): string | undefined {
  const content = assistantMessage(record)?.['content'];
  if (!Array.isArray(content)) return undefined;
  const text = content.flatMap((block) => (asObject(block)?.['type'] === 'text' ? [String(asObject(block)?.['text'] ?? '')] : [])).join('\n');
  return text || undefined;
}

export type SessionStats = Readonly<{ tokens?: Record<string, number>; cost?: number }>;

export function usageFromStats(stats: SessionStats): NonNullable<TaskRecord['usage']> {
  const tokens = stats.tokens ?? {};
  return {
    input: tokens['input'] ?? 0,
    output: tokens['output'] ?? 0,
    cacheRead: tokens['cacheRead'] ?? 0,
    cacheWrite: tokens['cacheWrite'] ?? 0,
    totalTokens: tokens['total'] ?? 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: stats.cost ?? 0 },
  };
}

export type TurnOutcome = Readonly<{ state: TurnState; output: string; stopped: boolean; startedAt: number; stats?: SessionStats }>;

export function settledPatch({ state, output, stopped, startedAt, stats }: TurnOutcome): Partial<TaskRecord> {
  const status = stopped || state.aborted ? 'interrupted' : state.failure ? 'failed' : 'settled';
  const text = status === 'failed' ? (state.failure ?? output) : output;
  return {
    status,
    output: text.slice(0, taskOutputLimit),
    toolUseCount: state.toolUses,
    durationMs: Date.now() - startedAt,
    ...(stats ? { usage: usageFromStats(stats), totalTokens: stats.tokens?.['total'] ?? 0 } : {}),
  };
}
