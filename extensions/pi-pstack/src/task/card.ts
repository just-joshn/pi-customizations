import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { Text } from '@earendil-works/pi-tui';

const COLLAPSED_LINES = 10;

interface CardDetails {
  subagentType: string;
  model: { provider: string; id: string; thinking?: string } | null;
  worktree?: { branch: string } | null;
  description?: string;
}

function isCardDetails(details: unknown): details is CardDetails {
  return typeof details === 'object' && details !== null && 'subagentType' in details && 'model' in details;
}

/** Heads the Task result with the Task description and the model that ran. */
export function taskCardText(result: Pick<AgentToolResult<unknown>, 'content' | 'details'>, expanded: boolean): string {
  const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
  const lines = text.split('\n');
  const body = expanded || lines.length <= COLLAPSED_LINES ? lines : [...lines.slice(0, COLLAPSED_LINES), `… ${lines.length - COLLAPSED_LINES} more lines`];
  if (!isCardDetails(result.details)) return body.join('\n');
  const { model, subagentType, worktree, description } = result.details;
  const modelName = model === null ? "Pi's default model" : `${model.provider}/${model.id}${model.thinking === undefined ? '' : `:${model.thinking}`}`;
  const branch = worktree === undefined || worktree === null ? '' : ` · branch ${worktree.branch}`;
  const title = description === undefined || description.trim() === '' ? '' : `${description.trim()} · `;
  return [`${title}${subagentType} · ${modelName}${branch}`, ...body].join('\n');
}

export function renderTaskCard(result: AgentToolResult<unknown>, options: { expanded: boolean }): Text {
  return new Text(taskCardText(result, options.expanded), 0, 0);
}

interface NotificationCardDetails {
  status: 'success' | 'error';
  agentId: string;
  title: string;
  detail: string;
}

function isNotificationCardDetails(details: unknown): details is NotificationCardDetails {
  const value = details as Partial<NotificationCardDetails> | null;
  return typeof value === 'object' && value !== null && (value.status === 'success' || value.status === 'error') && typeof value.agentId === 'string' && typeof value.title === 'string' && typeof value.detail === 'string';
}

export function taskNotificationCardText(message: { content: string | { type: string; text?: string }[]; details?: unknown }, expanded: boolean): string {
  if (!isNotificationCardDetails(message.details)) {
    const raw = typeof message.content === 'string' ? message.content : message.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('\n');
    const lines = raw.split('\n');
    return (expanded || lines.length <= COLLAPSED_LINES ? lines : [...lines.slice(0, COLLAPSED_LINES), `… ${lines.length - COLLAPSED_LINES} more lines`]).join('\n');
  }
  const { title, status, agentId, detail } = message.details;
  const lines = detail.split('\n');
  const body = expanded || lines.length <= COLLAPSED_LINES ? lines : [...lines.slice(0, COLLAPSED_LINES), `… ${lines.length - COLLAPSED_LINES} more lines`];
  const head = `${title.trim() === '' ? 'subagent' : title.trim()} · ${status} · agent ${agentId}`;
  return [head, ...body].join('\n');
}

export function renderTaskNotification(message: { content: string | { type: string; text?: string }[]; details?: unknown }, options: { expanded: boolean }): Text {
  return new Text(taskNotificationCardText(message, options.expanded), 0, 0);
}
