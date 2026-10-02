import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { AgentNode } from './agent-node.ts';
import type { NotificationData, NotificationKind } from './events.ts';

export const notificationMessageType = 'system_notification';
type Wake = Parameters<ExtensionAPI['sendMessage']>[0];

export const idleLogLine = (name: string, type: string): string => `Agent "${name}" (${type}) has finished processing and is now idle.`;

export type Notice = Readonly<{ data: NotificationData; wake: Wake }>;

function notice(kind: NotificationKind, node: AgentNode, summary: string): Notice {
  const data: NotificationData = { kind, agentId: node.id, summary };
  return { data, wake: { customType: notificationMessageType, content: `${summary} Use read_agent with agent_id ${node.id} to read its response.`, display: true, details: { kind, agent_id: node.id, agent_type: node.agentType } } };
}

/** The wake for a background agent whose turn ended: idle while it can take more messages, completed once it cannot. */
export function noticeFor(node: AgentNode): Notice | undefined {
  if (node.mode !== 'background' || node.cancelled === true) return undefined;
  if (node.status === 'idle') return notice('agent_idle', node, idleLogLine(node.agentDisplayName, node.agentType));
  if (node.status === 'failed') return notice('agent_completed', node, `Agent "${node.agentDisplayName}" (${node.agentType}) failed: ${node.error ?? 'Unknown error'}.`);
  if (node.status === 'completed') return notice('agent_completed', node, `Agent "${node.agentDisplayName}" (${node.agentType}) completed.`);
  return undefined;
}
