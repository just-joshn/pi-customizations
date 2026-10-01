import { type Static, Type } from 'typebox';
import { finalizeReport, modelFacingReport, oneShotAgentTypes } from './finalize.ts';
import type { HandbackState } from './handback.ts';
import type { Finding } from './output-trust.ts';
import { type ToolStats, ToolStatsSchema } from './tool-stats.ts';
import type { LaunchPlan } from './types.ts';

const modelHistoryFields = { modelsUsed: Type.Optional(Type.Array(Type.String())) };
const isolationFields = {
  requestedIsolation: Type.Optional(Type.Union([Type.Literal('worktree'), Type.Literal('remote')])),
  effectiveIsolation: Type.Optional(Type.Union([Type.Literal('worktree'), Type.Literal('local')])),
};
export type IsolationResult = Readonly<{ requestedIsolation?: 'worktree' | 'remote'; effectiveIsolation?: 'worktree' | 'local' }>;

export const AgentResultSchema = Type.Union([
  Type.Object({
    ...isolationFields,
    ...modelHistoryFields,
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
    ...isolationFields,
    ...modelHistoryFields,
    status: Type.Literal('completed'),
    prompt: Type.String(),
    agentId: Type.String(),
    agentType: Type.String(),
    content: Type.Array(Type.Object({ type: Type.Literal('text'), text: Type.String() })),
    resolvedModel: Type.Optional(Type.String()),
    totalToolUseCount: Type.Integer(),
    toolStats: Type.Optional(ToolStatsSchema),
    totalDurationMs: Type.Number(),
    totalTokens: Type.Number(),
    usage: Type.Optional(Type.Any()),
    harnessNoteCount: Type.Optional(Type.Integer()),
    harnessTailCount: Type.Optional(Type.Integer()),
    harnessSectionHash: Type.Optional(Type.String()),
    handback: Type.Optional(Type.Union([Type.Literal('send'), Type.Literal('flagged'), Type.Literal('withheld')])),
    handbackReport: Type.Optional(Type.Object({ text: Type.String(), warning: Type.Optional(Type.String()) })),
    worktreePath: Type.Optional(Type.String()),
    worktreeBranch: Type.Optional(Type.String()),
  }),
  Type.Object({ status: Type.Literal('remote_launched'), taskId: Type.String(), sessionUrl: Type.String(), description: Type.String(), prompt: Type.String(), outputFile: Type.String() }),
]);

export type AgentResult = Static<typeof AgentResultSchema>;

type Launched = Readonly<{
  id: string;
  sessionFile: string;
  modelReference?: string;
  modelsUsed?: readonly string[];
  output: string;
  usage?: { totalTokens: number };
  totalTokens?: number;
  toolUseCount?: number;
  toolStats?: ToolStats;
  durationMs?: number;
  agentName?: string;
  maxTurnsReached?: number;
  handback?: HandbackState;
}>;

function modelHistory(record: Launched): { modelsUsed?: string[] } {
  return record.modelsUsed && record.modelsUsed.length > 1 ? { modelsUsed: [...record.modelsUsed] } : {};
}

function modelIdentity(record: Launched): string | undefined {
  return record.modelReference?.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, '');
}

export function asyncLaunched(record: Launched, plan: LaunchPlan, extra: IsolationResult & { sharesCwd?: boolean; canReadOutputFile: boolean }): AgentResult {
  const model = modelIdentity(record);
  return {
    status: 'async_launched',
    agentId: record.id,
    description: plan.description,
    prompt: plan.prompt,
    outputFile: record.sessionFile,
    ...modelHistory(record),
    ...(model ? { resolvedModel: model } : {}),
    ...extra,
  };
}

export function completed(record: Launched, plan: LaunchPlan, extra: IsolationResult & { worktreePath?: string; worktreeBranch?: string } = {}, onFindings: (findings: readonly Finding[]) => void = () => {}): AgentResult {
  const model = modelIdentity(record);
  const { findings, ...report } = finalizeReport({
    output: record.output,
    agentType: plan.agentType,
    sender: record.agentName ?? record.id,
    ...(record.maxTurnsReached ? { maxTurnsReached: record.maxTurnsReached } : {}),
    ...(record.handback ? { handback: record.handback } : {}),
  });
  onFindings(findings);
  return {
    status: 'completed',
    prompt: plan.prompt,
    agentId: record.id,
    agentType: plan.agentType,
    ...report,
    ...modelHistory(record),
    ...(model ? { resolvedModel: model } : {}),
    totalToolUseCount: record.toolUseCount ?? 0,
    ...(record.toolStats ? { toolStats: { ...record.toolStats } } : {}),
    totalDurationMs: record.durationMs ?? 0,
    totalTokens: record.totalTokens ?? 0,
    ...(record.usage ? { usage: record.usage } : {}),
    ...extra,
  };
}

const launchedText = (agentId: string) =>
  `Async agent launched successfully. (This tool result is internal metadata \u2014 never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: ${agentId} (internal ID - do not mention to user. Use SendMessage with to: '${agentId}', summary: '<5-10 word recap>' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives \u2014 do not report, assume, or predict them; continue other work or respond to the user in the meantime.`;
const readableText = (outputFile: string) =>
  `Do not duplicate this agent's work \u2014 avoid working with the same files or topics it is using.\noutput_file: ${outputFile}\nDo NOT Read or tail this file via the shell tool \u2014 it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.`;
const unreadableText = 'In your own words, briefly tell the user what you launched \u2014 do not echo this tool result. Agent results will arrive in a subsequent message. If the user asks for progress, say the agent is still running.';
const sharesCwdText = 'Note: another write-capable agent is already running in this same working directory, and parallel agents share the working tree.';

function launchedResultText(result: Extract<AgentResult, { status: 'async_launched' }>): string {
  const access = result.canReadOutputFile && result.outputFile ? readableText(result.outputFile) : unreadableText;
  return `${launchedText(result.agentId)}\n${access}${result.sharesCwd ? `\n${sharesCwdText}` : ''}`;
}

function completedResultText(result: Extract<AgentResult, { status: 'completed' }>): string {
  const worktree = result.worktreePath ? `\nworktreePath: ${result.worktreePath}${result.worktreeBranch ? `\nworktreeBranch: ${result.worktreeBranch}` : ''}` : '';
  const report = modelFacingReport({ content: result.content, harnessNoteCount: result.harnessNoteCount ?? 0, harnessTailCount: result.harnessTailCount ?? 0, harnessSectionHash: result.harnessSectionHash ?? '' });
  if (oneShotAgentTypes.has(result.agentType) && !worktree) return report;
  const trailer = `agentId: ${result.agentId} (use SendMessage with to: '${result.agentId}', summary: '<5-10 word recap>' to continue this agent)${worktree}\n<usage>subagent_tokens: ${result.totalTokens}\ntool_uses: ${result.totalToolUseCount}\nduration_ms: ${result.totalDurationMs}</usage>`;
  return `${report}\n${trailer}`;
}

export function resultText(result: AgentResult): string {
  switch (result.status) {
    case 'async_launched':
      return launchedResultText(result);
    case 'completed':
      return completedResultText(result);
    case 'remote_launched':
      return `Remote agent launched. taskId: ${result.taskId}\nsession_url: ${result.sessionUrl}`;
    default:
      throw new Error(`Unexpected agent tool result status: ${(result as { status: string }).status}`);
  }
}
