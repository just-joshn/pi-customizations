import { formatSize, truncateHead } from '@earendil-works/pi-coding-agent';
import type { TaskStatus } from './task-status.ts';

export const noResponseText = 'Agent completed but produced no response.';
export const movedToBackgroundSuffix = ' Use read_agent to check for results.';
export const retiredText = 'Agent was retired after completing its turn to free memory and cannot receive follow-up messages.';
export const maxListedAgents = 50;
export const readWaitDefaultSeconds = 30;
export const readWaitMaxSeconds = 180;
export const rewindingStartMessage = 'Cannot start a task while the session is rewinding or disposing';
export const rewindingSubagentMessage = 'Cannot start subagent while the session is rewinding or disposing';
export const rewindingDeliverMessage = 'Cannot deliver a task message while the session is rewinding or disposing';

export type AgentView = Readonly<{
  id: string;
  agentType: string;
  name: string;
  status: TaskStatus;
  mode: 'sync' | 'background';
  description: string;
  elapsedMs: number;
  turns: readonly string[];
  error?: string;
}>;

export function boundedForModel(text: string, transcript: string): string {
  const kept = truncateHead(text);
  if (!kept.truncated) return text;
  return `${kept.content}\n\n[Output truncated: showing ${kept.outputLines} of ${kept.totalLines} lines (${formatSize(kept.outputBytes)} of ${formatSize(kept.totalBytes)}). The agent's full transcript is at ${transcript}.]`;
}

export function syncResultText(finalMessage: string): string {
  return finalMessage.length > 0 ? finalMessage : noResponseText;
}

export function backgroundStartedText(agentId: string): string {
  return `Agent started in background with agent_id: ${agentId}. You'll be notified when it completes. If you have nothing else to do, say that you are waiting and stop; otherwise continue with unrelated work. This agent supports multi-turn conversations: use write_agent only for follow-ups on the same task, and read_agent to check on it.`;
}

export function promptDetail(agentType: string, agentId: string, prompt: string): string {
  return `Prompt to ${agentType} agent (${agentId})\n\n${prompt}`;
}

export function movedToBackgroundText(agentId: string): string {
  return `Agent ${agentId} was moved to the background and is still running. You'll be notified when it completes.${movedToBackgroundSuffix}`;
}

function headline(view: AgentView): string {
  switch (view.status) {
    case 'running':
      return 'Agent is still running.';
    case 'idle':
      return 'Agent is idle (waiting for messages).';
    case 'completed':
      return view.turns.every((turn) => turn.length === 0) ? noResponseText : 'Agent completed.';
    case 'failed':
      return `Agent failed: ${view.error ?? 'Unknown error'}`;
    case 'cancelled':
      return 'Agent was cancelled.';
    default: {
      const exhaustive: never = view.status;
      return exhaustive;
    }
  }
}

export function readAgentText(view: AgentView, sinceTurn = 0): string {
  const header = [headline(view), `agent_id: ${view.id}`, `agent_type: ${view.agentType}`, `status: ${view.status}`, `description: ${view.description}`, `elapsed: ${Math.round(view.elapsedMs / 1000)}s`, `total_turns: ${view.turns.length}`];
  const shown = view.turns.flatMap((turn, index) => (index >= sinceTurn ? [`[Turn ${index}]\n${turn}`] : []));
  const body = shown.length > 0 ? shown : [`No responses from turn ${sinceTurn} onward.`];
  return `${header.join('\n')}\n\n${body.join('\n\n')}`;
}

export function writeAgentRefusal(view: Pick<AgentView, 'id' | 'mode' | 'status'>): string {
  if (view.mode === 'sync') return `write_agent only supports background agents. Agent ${view.id} was started in sync mode.`;
  return `write_agent only supports background agents that are running or idle. Agent ${view.id} is ${view.status}.`;
}

export function writeAgentSentText(view: Pick<AgentView, 'id' | 'status'>): string {
  const state = view.status === 'idle' ? 'It resumed work on the message' : 'The message was queued for its next turn';
  return `Message sent to agent ${view.id}. ${state}; use read_agent to read the reply.`;
}

export function listAgentsText(views: readonly AgentView[]): string {
  if (views.length === 0) return 'No agents.';
  return views.map((view) => `agent_id: ${view.id} | agent_type: ${view.agentType} | name: ${view.name} | mode: ${view.mode} | status: ${view.status} | description: ${view.description}`).join('\n');
}

export function listAgentsTooManyText(matched: number): string {
  return `The requested scope matches ${matched} agents, which exceeds the limit of ${maxListedAgents}. Pass an explicit agent_ids list.`;
}
