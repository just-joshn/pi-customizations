import type { AgentSession, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { TaskRecord } from '../worker-records.ts';
import { finalizeReport, modelFacingReport } from './finalize.ts';
import { agentNotification, type NotificationOutcome, notificationSummary } from './notification.ts';
import type { Finding } from './output-trust.ts';

const taskNotificationType = 'task_notification';
type Wake = Parameters<ExtensionAPI['sendMessage']>[0];
type Messages = AgentSession['messages'];
export type StoppedBy = 'parent' | 'user';
export type FlaggedOutput = Readonly<{ agent_id: string; surface: string; patterns: string[]; categories: string[]; match_count: number }>;

export function lastMeteredTokens(messages: Messages): number | undefined {
  const last = messages.findLast((message) => message.role === 'assistant' && message.usage !== undefined);
  if (last?.role !== 'assistant') return undefined;
  const { input, output, cacheRead, cacheWrite } = last.usage;
  return input + output + cacheRead + cacheWrite;
}

export function lastReportText(messages: Messages): string {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') continue;
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
    if (text) return text;
  }
  return '';
}

export function flaggedOutput(agentId: string, surface: string, findings: readonly Finding[]): FlaggedOutput | undefined {
  const reportable = findings.filter((finding) => finding.reportable);
  if (!reportable.length) return undefined;
  return {
    agent_id: agentId,
    surface,
    patterns: [...new Set(reportable.map((finding) => finding.pattern))],
    categories: [...new Set(reportable.map((finding) => finding.category))],
    match_count: reportable.reduce((sum, finding) => sum + finding.count, 0),
  };
}

function outcomeOf(record: TaskRecord, stoppedBy: StoppedBy | undefined): NotificationOutcome {
  switch (record.status) {
    case 'failed':
      return { status: 'failed', error: record.output.split('\n')[0] ?? '' };
    case 'interrupted':
    case 'running':
      return { status: 'stopped', ...(stoppedBy ? { killedBy: stoppedBy } : {}) };
    case 'settled':
      return { status: 'completed', ...(record.maxTurnsReached ? { maxTurnsReached: record.maxTurnsReached } : {}) };
  }
}

function notificationParts(record: TaskRecord, output: string, stoppedBy?: StoppedBy) {
  const outcome = outcomeOf(record, stoppedBy);
  const report =
    outcome.status === 'completed'
      ? finalizeReport({ output, agentType: record.persona, sender: record.agentName ?? record.id, ...(record.maxTurnsReached ? { maxTurnsReached: record.maxTurnsReached } : {}), ...(record.handback ? { handback: record.handback } : {}) })
      : undefined;
  const usage = record.durationMs === undefined ? undefined : { totalTokens: record.totalTokens ?? 0, toolUses: record.toolUseCount ?? 0, durationMs: record.durationMs };
  const worktree = record.worktreePath && !record.worktreeCleanlyRemoved ? { path: record.worktreePath, ...(record.worktreeBranch ? { branch: record.worktreeBranch } : {}) } : undefined;
  return { outcome, report, usage, worktree, worktreeCleanupWarning: record.worktreeCleanupWarning };
}

export function taskNotification(record: TaskRecord, output: string, stoppedBy?: StoppedBy): { message: Wake; findings: readonly Finding[] } {
  const { outcome, report, usage, worktree, worktreeCleanupWarning } = notificationParts(record, output, stoppedBy);
  const description = record.description ?? record.persona;
  const content = agentNotification({
    taskId: record.id,
    ...(record.toolUseId ? { toolUseId: record.toolUseId } : {}),
    outputFile: record.sessionFile,
    description,
    outcome,
    ...(report ? { result: modelFacingReport(report) } : {}),
    ...(usage ? { usage } : {}),
    ...(worktree ? { worktree } : {}),
    ...(worktreeCleanupWarning ? { worktreeCleanupWarning } : {}),
  });
  const details = {
    task_id: record.id,
    ...(record.toolUseId ? { tool_use_id: record.toolUseId } : {}),
    status: outcome.status,
    output_file: record.sessionFile,
    summary: notificationSummary(description, outcome),
    task_type: 'local_agent',
    ...(usage ? { usage: { total_tokens: usage.totalTokens, tool_uses: usage.toolUses, duration_ms: usage.durationMs } } : {}),
    ...(worktreeCleanupWarning ? { worktree_cleanup_warning: worktreeCleanupWarning } : {}),
  };
  return { message: { customType: taskNotificationType, content, display: true, details }, findings: report?.findings ?? [] };
}
