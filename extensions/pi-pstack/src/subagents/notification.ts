export type NotificationOutcome =
  | Readonly<{ status: 'completed'; maxTurnsReached?: number; interim?: boolean }>
  | Readonly<{ status: 'failed'; error?: string }>
  | Readonly<{ status: 'stopped'; killedBy?: 'parent' | 'user'; error?: string }>;
export type NotificationUsage = Readonly<{ totalTokens: number; toolUses: number; durationMs: number }>;
export type AgentNotificationInput = Readonly<{
  taskId: string;
  toolUseId?: string;
  outputFile?: string;
  description: string;
  outcome: NotificationOutcome;
  result?: string;
  usage?: NotificationUsage;
  worktree?: Readonly<{ path: string; branch?: string }>;
  worktreeCleanupWarning?: string;
}>;

const defaultNote = 'A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.';
const interimNote = 'This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports, and the same task-id notifies again if it does; the result below may be interim.';

export function escapeMarkup(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function terminalPhrase(outcome: NotificationOutcome): string {
  switch (outcome.status) {
    case 'completed':
      return outcome.maxTurnsReached ? `stopped at its ${outcome.maxTurnsReached}-turn limit (partial result; SendMessage to task-id to continue)` : 'finished';
    case 'failed':
      return `failed: ${outcome.error || 'Unknown error'}`;
    case 'stopped':
      if (outcome.killedBy === 'parent') return 'was stopped by Claude';
      if (outcome.killedBy === 'user') return 'was stopped by user';
      return outcome.error ? `was stopped: ${outcome.error}` : 'was stopped';
  }
}

export function notificationSummary(description: string, outcome: NotificationOutcome): string {
  return `Agent "${description}" ${terminalPhrase(outcome)}`;
}

function taskNotification(fields: ReadonlyArray<readonly [string, string | undefined]>, body: string): string {
  const head = fields.flatMap(([tag, value]) => (value ? [`\n<${tag}>${value}</${tag}>`] : [])).join('');
  return `<task-notification>${head}${body}\n</task-notification>`;
}

function notificationBody(input: AgentNotificationInput): string {
  const note = input.outcome.status === 'completed' && input.outcome.interim ? interimNote : defaultNote;
  const result = input.result ? `\n<result>${escapeMarkup(input.result)}</result>` : '';
  const usage = input.usage ? `\n<usage><subagent_tokens>${input.usage.totalTokens}</subagent_tokens><tool_uses>${input.usage.toolUses}</tool_uses><duration_ms>${input.usage.durationMs}</duration_ms></usage>` : '';
  const branch = input.worktree?.branch ? `<worktreeBranch>${escapeMarkup(input.worktree.branch)}</worktreeBranch>` : '';
  const worktree = input.worktree ? `\n<worktree><worktreePath>${input.worktree.path}</worktreePath>${branch}</worktree>` : '';
  const cleanupWarning = input.worktreeCleanupWarning ? `\n<worktree-cleanup-warning>${escapeMarkup(input.worktreeCleanupWarning)}</worktree-cleanup-warning>` : '';
  return `\n<note>${note}</note>${result}${usage}${worktree}${cleanupWarning}`;
}

export function agentNotification(input: AgentNotificationInput): string {
  const fields = [
    ['task-id', input.taskId],
    ['tool-use-id', input.toolUseId],
    ['output-file', input.outputFile],
    ['status', input.outcome.status],
    ['summary', escapeMarkup(notificationSummary(input.description, input.outcome))],
  ] as const;
  return taskNotification(fields, notificationBody(input));
}
