import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { AgentNode } from './agent-node.ts';
import type { ChildPlan } from './context-builder.ts';
import { type CompletedData, type FailedData, type FinishedData, provenanceOf, type StartedData } from './events.ts';
import type { AgentView } from './tool-results.ts';

export type NodeFacts = Readonly<{ toolCallId: string; description: string; name: string; depth: number; now: number }>;

export function initialNode(plan: ChildPlan, facts: NodeFacts): AgentNode {
  const { selection, definition } = plan;
  return {
    id: plan.agentId,
    registryId: plan.registryId,
    ...(plan.parentRegistryId !== undefined ? { parentRegistryId: plan.parentRegistryId } : {}),
    toolCallId: facts.toolCallId,
    agentType: definition.name,
    agentDisplayName: facts.name,
    agentDescription: definition.description,
    description: facts.description,
    prompt: plan.userMessage,
    mode: plan.mode,
    status: 'running',
    depth: facts.depth,
    turns: [],
    startedAt: facts.now,
    model: selection.model.reference,
    modelSource: selection.source,
    taskModelSource: selection.taskSource,
    contextTier: selection.contextTier,
    ...(selection.effort !== undefined ? { effort: selection.effort } : {}),
    firstDispatchedModel: selection.firstDispatched,
    ...(selection.configured !== undefined ? { configuredModel: selection.configured } : {}),
    ...(selection.requested !== undefined ? { requestedModel: selection.requested } : {}),
    ...(selection.overrideReason !== undefined ? { overrideReason: selection.overrideReason } : {}),
    totalToolCalls: 0,
    totalTokens: 0,
    sessionFile: '',
    cwd: plan.cwd,
  };
}

export function startedData(node: AgentNode): StartedData {
  return {
    toolCallId: node.toolCallId,
    agentName: node.agentType,
    agentDisplayName: node.agentDisplayName,
    agentDescription: node.agentDescription,
    model: node.model,
    taskModelSource: node.taskModelSource,
    modelSelectionSource: node.modelSource,
    resumable: false,
    agentType: node.agentType,
    executionMode: node.mode,
    ...(node.parentRegistryId !== undefined ? { parentId: node.parentRegistryId } : {}),
    ...(node.workflowRunId !== undefined ? { workflowRunId: node.workflowRunId, factoryRunId: node.workflowRunId } : {}),
  };
}

function finishedData(node: AgentNode): FinishedData {
  return {
    toolCallId: node.toolCallId,
    agentName: node.agentType,
    agentDisplayName: node.agentDisplayName,
    totalToolCalls: node.totalToolCalls,
    totalTokens: node.totalTokens,
    durationMs: Math.max(0, (node.endedAt ?? node.startedAt) - node.startedAt),
    ...provenanceOf({
      model: node.model,
      firstDispatched: node.firstDispatchedModel,
      source: node.modelSource,
      ...(node.configuredModel !== undefined ? { configured: node.configuredModel } : {}),
      ...(node.requestedModel !== undefined ? { requested: node.requestedModel } : {}),
      ...(node.overrideReason !== undefined ? { overrideReason: node.overrideReason } : {}),
    }),
  };
}

export function completedData(node: AgentNode): CompletedData {
  return { ...finishedData(node), ...(node.cancelled ? { cancelled: true as const } : {}) };
}

export function failedData(node: AgentNode): FailedData {
  return { ...finishedData(node), error: node.error ?? 'Unknown error' };
}

export function viewOf(node: AgentNode, now: number): AgentView {
  return {
    id: node.id,
    agentType: node.agentType,
    name: node.agentDisplayName,
    status: node.status,
    mode: node.mode,
    description: node.description,
    elapsedMs: Math.max(0, (node.endedAt ?? now) - node.startedAt),
    turns: node.turns,
    ...(node.error !== undefined ? { error: node.error } : {}),
  };
}

export type Measured = Readonly<{ toolCalls: number; tokens: number }>;

export function measure(messages: AgentSession['messages']): Measured {
  const assistants = messages.flatMap((message) => (message.role === 'assistant' ? [message] : []));
  return { toolCalls: messages.filter((message) => message.role === 'toolResult').length, tokens: assistants.reduce((sum, message) => sum + (message.usage?.totalTokens ?? 0), 0) };
}
