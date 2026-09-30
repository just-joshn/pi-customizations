import { type Static, Type } from 'typebox';
import { capResultText } from './limits.ts';
import type { LaunchPlan } from './types.ts';

export const AgentResultSchema = Type.Union([
  Type.Object({
    status: Type.Literal('async_launched'),
    agentId: Type.String(),
    description: Type.String(),
    prompt: Type.String(),
    outputFile: Type.String(),
    canReadOutputFile: Type.Boolean(),
    resolvedModel: Type.Optional(Type.String()),
    sharesCwd: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    status: Type.Literal('completed'),
    prompt: Type.String(),
    agentId: Type.String(),
    agentType: Type.String(),
    content: Type.Array(Type.Object({ type: Type.Literal('text'), text: Type.String() })),
    resolvedModel: Type.Optional(Type.String()),
    totalToolUseCount: Type.Integer(),
    totalDurationMs: Type.Number(),
    totalTokens: Type.Number(),
    usage: Type.Optional(Type.Any()),
    worktreePath: Type.Optional(Type.String()),
    worktreeBranch: Type.Optional(Type.String()),
  }),
  Type.Object({ status: Type.Literal('remote_launched'), taskId: Type.String(), sessionUrl: Type.String(), description: Type.String(), prompt: Type.String(), outputFile: Type.String() }),
]);

export type AgentResult = Static<typeof AgentResultSchema>;

type Launched = Readonly<{ id: string; outputFile: string; modelReference?: string; output: string; usage?: { totalTokens: number }; toolUseCount?: number; durationMs?: number }>;

export function asyncLaunched(record: Launched, plan: LaunchPlan, extra: { sharesCwd?: boolean } = {}): AgentResult {
  return {
    status: 'async_launched',
    agentId: record.id,
    description: plan.description,
    prompt: plan.prompt,
    outputFile: record.outputFile,
    canReadOutputFile: true,
    ...(record.modelReference ? { resolvedModel: record.modelReference } : {}),
    ...(extra.sharesCwd ? { sharesCwd: true } : {}),
  };
}

export function completed(record: Launched, plan: LaunchPlan, extra: { worktreePath?: string; worktreeBranch?: string } = {}): AgentResult {
  return {
    status: 'completed',
    prompt: plan.prompt,
    agentId: record.id,
    agentType: plan.agentType,
    content: [{ type: 'text', text: capResultText(record.output) }],
    ...(record.modelReference ? { resolvedModel: record.modelReference } : {}),
    totalToolUseCount: record.toolUseCount ?? 0,
    totalDurationMs: record.durationMs ?? 0,
    totalTokens: record.usage?.totalTokens ?? 0,
    ...(record.usage ? { usage: record.usage } : {}),
    ...extra,
  };
}

export function resultText(result: AgentResult): string {
  switch (result.status) {
    case 'async_launched':
      return `Async agent launched successfully.\nagentId: ${result.agentId} (internal ID - do not mention to user. Use SendMessage with to: '${result.agentId}' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.\noutput_file: ${result.outputFile}${result.sharesCwd ? '\nNote: another write-capable agent is already running in this same working directory, and parallel agents share the working tree.' : ''}`;
    case 'completed':
      return `${result.content.map((block) => block.text).join('\n')}\nagentId: ${result.agentId}`;
    case 'remote_launched':
      return `Remote agent launched. taskId: ${result.taskId}\nsession_url: ${result.sessionUrl}`;
    default:
      throw new Error(`Unexpected agent tool result status: ${(result as { status: string }).status}`);
  }
}
