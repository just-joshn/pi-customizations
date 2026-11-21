import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { createGoalState, isLiveGoal, transitionGoalStatus } from './state.ts';
import { CreateGoalArgsSchema, GOAL_TOOL_NAMES, type GoalState, type GoalStatus, type GoalToolDetails, UpdateGoalArgsSchema } from './types.ts';
import { renderGoalToolCall, renderGoalToolResult } from './ui-renderers.ts';

export interface GoalToolsCallbacks {
  readonly getGoal: () => GoalState | undefined;
  readonly setGoal: (next: GoalState | undefined, ctx: ExtensionContext) => void;
}

const CreateGoalParams = Type.Object({
  objective: Type.String({
    description: 'Clear, durable objective to pursue across turns until complete.',
  }),
});

const UpdateGoalParams = Type.Object({
  status: Type.Union([Type.Literal('active'), Type.Literal('paused'), Type.Literal('complete'), Type.Literal('cleared')], { description: 'Next lifecycle status for the current goal.' }),
});

function buildGoalError(kind: 'create' | 'update', error: string, extra?: { readonly objective?: string; readonly status?: GoalStatus }): AgentToolResult<GoalToolDetails> {
  return {
    content: [{ type: 'text', text: error }],
    details: {
      kind,
      outcome: 'error',
      error,
      ...(extra?.objective !== undefined ? { objective: extra.objective } : {}),
      ...(extra?.status !== undefined ? { status: extra.status } : {}),
    },
  };
}

function registerCreateGoalTool(pi: ExtensionAPI, callbacks: GoalToolsCallbacks): void {
  pi.registerTool({
    name: GOAL_TOOL_NAMES.createGoal,
    label: 'Create Goal',
    description: 'Create and activate a durable long-lived goal that automatically continues across turns while idle until complete.',
    parameters: CreateGoalParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult<GoalToolDetails>> {
      const parsed = CreateGoalArgsSchema.safeParse(params);
      if (!parsed.success) {
        return buildGoalError('create', parsed.error.issues[0]?.message ?? 'Invalid goal objective.');
      }
      if (signal?.aborted) {
        return { content: [{ type: 'text', text: 'Goal creation cancelled.' }], details: { kind: 'create', outcome: 'cancelled', objective: parsed.data.objective } };
      }
      const next = createGoalState({ conversationId: ctx.sessionManager.getSessionId(), objective: parsed.data.objective, nowMs: Date.now() });
      callbacks.setGoal(next, ctx);
      return {
        content: [{ type: 'text', text: `Goal created and active (id: ${next.goalId}): ${next.objective}` }],
        details: { kind: 'create', outcome: 'success', objective: next.objective, goalId: next.goalId, status: next.status },
      };
    },
    renderCall(args, theme) {
      return renderGoalToolCall('create', args, theme);
    },
    renderResult(result, options, theme) {
      return renderGoalToolResult('create', result, options, theme);
    },
  });
}

function registerUpdateGoalTool(pi: ExtensionAPI, callbacks: GoalToolsCallbacks): void {
  pi.registerTool({
    name: GOAL_TOOL_NAMES.updateGoal,
    label: 'Update Goal',
    description: 'Update the status of the current long-lived goal (active, paused, complete, or cleared).',
    parameters: UpdateGoalParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult<GoalToolDetails>> {
      const parsed = UpdateGoalArgsSchema.safeParse(params);
      if (!parsed.success) {
        return buildGoalError('update', parsed.error.issues[0]?.message ?? 'Invalid goal status.');
      }
      if (signal?.aborted) {
        return { content: [{ type: 'text', text: 'Goal update cancelled.' }], details: { kind: 'update', outcome: 'cancelled', status: parsed.data.status } };
      }
      const current = callbacks.getGoal();
      if (!isLiveGoal(current)) {
        return buildGoalError('update', 'No goal exists in this session. Call create_goal first.', { status: parsed.data.status });
      }
      const next = transitionGoalStatus(current, parsed.data.status, Date.now());
      callbacks.setGoal(next, ctx);
      return {
        content: [{ type: 'text', text: `Goal status updated to ${next.status}.` }],
        details: { kind: 'update', outcome: 'success', status: next.status, goalId: next.goalId, objective: next.objective },
      };
    },
    renderCall(args, theme) {
      return renderGoalToolCall('update', args, theme);
    },
    renderResult(result, options, theme) {
      return renderGoalToolResult('update', result, options, theme);
    },
  });
}

export function registerGoalTools(pi: ExtensionAPI, callbacks: GoalToolsCallbacks): void {
  registerCreateGoalTool(pi, callbacks);
  registerUpdateGoalTool(pi, callbacks);
}
