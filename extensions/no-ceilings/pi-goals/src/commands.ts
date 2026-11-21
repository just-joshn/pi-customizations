import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { buildGoalContinuationMessage } from './prompts.ts';
import { createGoalState, formatGoalStatusText, isGoalActive, isGoalPaused, isLiveGoal, transitionGoalStatus } from './state.ts';
import { GoalCommandArgsSchema, type GoalState, ONE, ZERO } from './types.ts';

const GOAL_COMMAND_PREFIX = '/goal';
const GOAL_USAGE_HINT = 'Usage: /goal <objective>';
const GOAL_SUBCOMMANDS_HINT = 'Subcommands: /goal status | /goal pause | /goal resume | /goal complete | /goal clear';

export interface GoalCommandsCallbacks {
  readonly getGoal: () => GoalState | undefined;
  readonly setGoal: (next: GoalState | undefined, ctx: ExtensionContext) => void;
}

type SubcommandHandler = (pi: ExtensionAPI, callbacks: GoalCommandsCallbacks, ctx: ExtensionContext) => void;

function finishGoal(status: 'complete' | 'cleared'): SubcommandHandler {
  return (_pi, callbacks, ctx) => {
    const current = callbacks.getGoal();
    if (!isLiveGoal(current)) {
      ctx.ui.notify('No goal to update.', 'warning');
      return;
    }
    const next = transitionGoalStatus(current, status, Date.now());
    callbacks.setGoal(next, ctx);
    ctx.ui.notify(`Goal ${next.status}: ${next.objective}`, 'info');
  };
}

const GOAL_SUBCOMMANDS: Readonly<Record<string, SubcommandHandler>> = {
  status: (_pi, callbacks, ctx) => {
    const current = callbacks.getGoal();
    if (!isLiveGoal(current)) {
      ctx.ui.notify(`No active goal. ${GOAL_USAGE_HINT}`, 'info');
      return;
    }
    const statusLine = formatGoalStatusText(current, Date.now()) ?? `Goal ${current.status}`;
    ctx.ui.notify(`${statusLine} — ${current.objective} (continuations: ${current.continuationCount})`, 'info');
  },
  pause: (_pi, callbacks, ctx) => {
    const current = callbacks.getGoal();
    if (!isGoalActive(current)) {
      ctx.ui.notify('No active goal to pause.', 'warning');
      return;
    }
    const paused = transitionGoalStatus(current, 'paused', Date.now());
    callbacks.setGoal(paused, ctx);
    ctx.ui.notify(formatGoalStatusText(paused, Date.now()) ?? 'Goal paused', 'info');
  },
  resume: (pi, callbacks, ctx) => {
    const current = callbacks.getGoal();
    if (!isGoalPaused(current)) {
      ctx.ui.notify('No paused goal to resume.', 'warning');
      return;
    }
    const activated = transitionGoalStatus(current, 'active', Date.now());
    const resumed: GoalState = { ...activated, continuationCount: activated.continuationCount + ONE };
    callbacks.setGoal(resumed, ctx);
    pi.sendMessage(buildGoalContinuationMessage(resumed), { triggerTurn: true, deliverAs: 'followUp' });
  },
  complete: finishGoal('complete'),
  clear: finishGoal('cleared'),
};

export function registerGoalCommands(pi: ExtensionAPI, callbacks: GoalCommandsCallbacks): void {
  pi.registerCommand('goal', {
    description: 'Start a durable goal that continues while idle',
    handler: async (args, ctx) => {
      const trimmed = GoalCommandArgsSchema.parse(args).trim();
      if (trimmed.length === ZERO) {
        const current = callbacks.getGoal();
        const statusText = formatGoalStatusText(current, Date.now());
        ctx.ui.notify(statusText ? `${statusText} — ${current?.objective ?? ''}\n${GOAL_SUBCOMMANDS_HINT}` : GOAL_USAGE_HINT, 'info');
        return;
      }
      const key = trimmed.toLowerCase();
      const subcommand = Object.hasOwn(GOAL_SUBCOMMANDS, key) ? GOAL_SUBCOMMANDS[key] : undefined;
      if (subcommand !== undefined) {
        subcommand(pi, callbacks, ctx);
        return;
      }
      const next = createGoalState({ conversationId: ctx.sessionManager.getSessionId(), objective: trimmed, nowMs: Date.now() });
      callbacks.setGoal(next, ctx);
      pi.sendUserMessage(`${GOAL_COMMAND_PREFIX} ${trimmed}`, { deliverAs: 'followUp' });
    },
  });
}
