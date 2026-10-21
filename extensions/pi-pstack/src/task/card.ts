import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { Text } from '@earendil-works/pi-tui';

const COLLAPSED_LINES = 10;

interface CardDetails {
  subagentType: string;
  model: { provider: string; id: string; thinking?: string } | null;
  worktree?: { branch: string } | null;
}

function isCardDetails(details: unknown): details is CardDetails {
  return typeof details === 'object' && details !== null && 'subagentType' in details && 'model' in details;
}

/** Cursor's subagent task card shows which model ran; this card heads the result with the agent type and model. */
export function taskCardText(result: Pick<AgentToolResult<unknown>, 'content' | 'details'>, expanded: boolean): string {
  const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
  const lines = text.split('\n');
  const body = expanded || lines.length <= COLLAPSED_LINES ? lines : [...lines.slice(0, COLLAPSED_LINES), `… ${lines.length - COLLAPSED_LINES} more lines`];
  if (!isCardDetails(result.details)) return body.join('\n');
  const { model, subagentType, worktree } = result.details;
  const modelName = model === null ? "Pi's default model" : `${model.provider}/${model.id}${model.thinking === undefined ? '' : `:${model.thinking}`}`;
  const branch = worktree === undefined || worktree === null ? '' : ` · branch ${worktree.branch}`;
  return [`${subagentType} · ${modelName}${branch}`, ...body].join('\n');
}

export function renderTaskCard(result: AgentToolResult<unknown>, options: { expanded: boolean }): Text {
  return new Text(taskCardText(result, options.expanded), 0, 0);
}
