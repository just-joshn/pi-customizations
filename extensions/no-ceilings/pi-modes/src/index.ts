import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, TextContent } from '@earendil-works/pi-ai';
import { type ExtensionAPI, type ExtensionContext, isToolCallEventType, type SessionEntry, type ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { Key } from '@earendil-works/pi-tui';
import { registerModeCommands } from './commands.ts';
import { createDebugServerController } from './debug-server.ts';
import { readPlanFileFromUri } from './plan-files.ts';
import { advancePlanSteps, applyCompletedSteps, extractStepsFromMarkdown } from './plan-progress.ts';
import { buildModeContextMessage } from './prompts.ts';
import { extractReproductionSteps } from './reproduction-steps.ts';
import { isSafeReadOnlyCommand } from './shell-guard.ts';
import { computeActiveToolsForMode, createInitialState, formatModeLabel, getNextMode, isReadOnlyMode, normalizeModeAlias, restorePersistedState, toPersistedState } from './state.ts';
import { registerModeTools } from './tools.ts';
import {
  ENTRY_CUSTOM_TYPE,
  MODE_CONTEXT_CUSTOM_TYPE,
  type ModeId,
  type ModesRuntimeState,
  ONE,
  PersistedModeStateSchema,
  PLAN_COMPLETE_CUSTOM_TYPE,
  PLAN_EXECUTE_CUSTOM_TYPE,
  READ_ONLY_DISABLED_TOOLS,
  type TrackedPlanStep,
  ZERO,
} from './types.ts';
import { DEBUG_MARK_FIXED_MESSAGE, DEBUG_PROCEED_MESSAGE, promptDebugDecision, promptPlanDecision, syncModeUi } from './ui-flows.ts';

const STALE_MODE_MARKERS = ['[ASK MODE ACTIVE]', '[PLAN MODE ACTIVE]', '[DEBUG MODE ACTIVE]'] as const;
const DEBUG_LOG_POLL_MS = 1000;
const NOT_FOUND = -1;

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === 'assistant' && Array.isArray(message.content);
}

function extractAssistantMessageFromEntry(entry: SessionEntry): AssistantMessage | undefined {
  if (entry.type !== 'message' || !('message' in entry)) {
    return undefined;
  }
  const msg = entry.message as AgentMessage;
  return isAssistantMessage(msg) ? msg : undefined;
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') {
        return block.text;
      }
      if (block.type === 'thinking' && 'thinking' in block && typeof block.thinking === 'string') {
        return block.thinking;
      }
      return '';
    })
    .join('\n');
}

function isStaleModeContextMessage(message: AgentMessage): boolean {
  const customType = 'customType' in message && typeof message.customType === 'string' ? message.customType : undefined;
  if (customType === MODE_CONTEXT_CUSTOM_TYPE) {
    return true;
  }
  if (message.role !== 'user') {
    return false;
  }
  const content = message.content;
  if (typeof content === 'string') {
    return STALE_MODE_MARKERS.some((marker) => content.includes(marker));
  }
  if (Array.isArray(content)) {
    return content.some((part) => part.type === 'text' && STALE_MODE_MARKERS.some((marker) => (part as TextContent).text.includes(marker)));
  }
  return false;
}

function evaluateToolCallGuard(mode: ModeId, event: ToolCallEvent): { block: true; reason: string } | undefined {
  if (!isReadOnlyMode(mode)) {
    return undefined;
  }
  if (READ_ONLY_DISABLED_TOOLS.has(event.toolName)) {
    return { block: true, reason: `${formatModeLabel(mode)} mode is read-only. Switch to Agent mode before editing files.` };
  }
  if (isToolCallEventType('bash', event) && !isSafeReadOnlyCommand(event.input.command)) {
    return { block: true, reason: `${formatModeLabel(mode)} mode: mutating shell command blocked. Switch to Agent mode first.\nCommand: ${event.input.command}` };
  }
  return undefined;
}

function buildPlanExecutionBody(planContent: string | undefined, steps: readonly TrackedPlanStep[]): string {
  const stepList = steps.map((step) => `${step.step}. ${step.text}`).join('\n');
  return ['Execute the approved plan.', planContent ? `\nPlan:\n${planContent}` : '', stepList ? `\nRemaining steps:\n${stepList}\nAfter completing a step, include [DONE:n] in your response.` : '']
    .filter((part) => part.length > ZERO)
    .join('\n');
}

function readInitialModeFromFlags(pi: ExtensionAPI): ModeId | undefined {
  if (pi.getFlag('plan') === true) {
    return 'plan';
  }
  const modeFlag = pi.getFlag('mode');
  return typeof modeFlag === 'string' ? normalizeModeAlias(modeFlag) : undefined;
}

function reconcileResumedPlanSteps(entries: readonly SessionEntry[], steps: readonly TrackedPlanStep[]): readonly TrackedPlanStep[] {
  let executeIndex = NOT_FOUND;
  for (let idx = entries.length - ONE; idx >= ZERO; idx -= ONE) {
    const entry = entries[idx];
    if (entry && 'customType' in entry && entry.customType === PLAN_EXECUTE_CUSTOM_TYPE) {
      executeIndex = idx;
      break;
    }
  }
  const assistantTexts = entries
    .slice(executeIndex + ONE)
    .map(extractAssistantMessageFromEntry)
    .filter((msg): msg is AssistantMessage => msg !== undefined)
    .map(getAssistantText);
  if (assistantTexts.length === ZERO) {
    return steps;
  }
  const combined = assistantTexts.join('\n');
  return advancePlanSteps(combined, steps);
}

function restoreStateFromSession(ctx: ExtensionContext): ModesRuntimeState {
  const entries = ctx.sessionManager.getEntries();
  const lastEntry = entries.filter((entry) => entry.type === 'custom' && 'customType' in entry && entry.customType === ENTRY_CUSTOM_TYPE).at(-ONE);
  if (!lastEntry || !('data' in lastEntry)) {
    return createInitialState();
  }
  const parsed = PersistedModeStateSchema.safeParse(lastEntry.data);
  if (!parsed.success) {
    return createInitialState();
  }
  const restored = restorePersistedState(parsed.data);
  if (!restored.planExecuting || restored.planSteps.length === ZERO) {
    return restored;
  }
  const reconciled = reconcileResumedPlanSteps(entries, restored.planSteps);
  if (reconciled.every((step) => step.completed)) {
    return { ...restored, planExecuting: false, planSteps: [] };
  }
  return { ...restored, planSteps: reconciled };
}

interface ModeRuntimeController {
  readonly getState: () => ModesRuntimeState;
  readonly setState: (next: ModesRuntimeState) => void;
  readonly persist: () => void;
  readonly ensureDebugConfig: (ctx: ExtensionContext) => Promise<void>;
  readonly applyMode: (nextMode: ModeId, ctx: ExtensionContext, shouldPersist?: boolean) => Promise<void>;
  readonly reviewExistingPlan: (ctx: ExtensionContext) => Promise<void>;
  readonly stopDebugServer: () => Promise<void>;
}

function createDebugPoller(getState: () => ModesRuntimeState): { readonly sync: (ctx: ExtensionContext) => void; readonly stop: () => void } {
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
  const sync = (ctx: ExtensionContext): void => {
    stop();
    if (getState().mode !== 'debug' || !ctx.hasUI) {
      return;
    }
    const timer = setInterval(() => {
      syncModeUi(ctx, getState());
    }, DEBUG_LOG_POLL_MS);
    timer.unref?.();
    pollTimer = timer;
  };
  return { sync, stop };
}

async function executePlanNow(pi: ExtensionAPI, ctrl: ModeRuntimeController, ctx: ExtensionContext): Promise<void> {
  const current = ctrl.getState();
  const planContent = current.currentPlanUri ? readPlanFileFromUri(current.currentPlanUri) : undefined;
  const steps: readonly TrackedPlanStep[] = current.planSteps.length > ZERO ? current.planSteps : planContent ? extractStepsFromMarkdown(planContent) : [];
  ctrl.setState({ ...current, currentPlanUri: undefined, pendingPlanSuggestion: false, planExecuting: steps.length > ZERO, planSteps: steps });
  await ctrl.applyMode('agent', ctx);
  pi.sendMessage({ customType: PLAN_EXECUTE_CUSTOM_TYPE, content: buildPlanExecutionBody(planContent, steps), display: true }, { triggerTurn: true, deliverAs: 'followUp' });
}

async function reviewPlanNow(pi: ExtensionAPI, ctrl: ModeRuntimeController, ctx: ExtensionContext): Promise<void> {
  const current = ctrl.getState();
  if (!current.currentPlanUri) {
    return;
  }
  const decision = await promptPlanDecision(ctx, `(${current.currentPlanUri})`);
  ctrl.setState({ ...ctrl.getState(), pendingPlanSuggestion: false });
  if (decision === 'build') {
    await executePlanNow(pi, ctrl, ctx);
    return;
  }
  if (decision === 'revise') {
    const feedback = (await ctx.ui.editor('Describe how to revise the plan:', ''))?.trim();
    if (feedback && feedback.length > ZERO) {
      pi.sendUserMessage(feedback, { deliverAs: 'followUp' });
    }
  }
}

function createRuntimeController(pi: ExtensionAPI): ModeRuntimeController {
  let state: ModesRuntimeState = createInitialState();
  const debugServer = createDebugServerController();
  const poller = createDebugPoller(() => state);

  const persist = (): void => {
    pi.appendEntry(ENTRY_CUSTOM_TYPE, toPersistedState(state));
  };

  const ensureDebugConfig = async (ctx: ExtensionContext): Promise<void> => {
    if (state.mode !== 'debug') {
      return;
    }
    const config = await debugServer.getConfig(ctx.cwd, ctx.sessionManager.getSessionId(), state.lastDebugServerPort);
    state = { ...state, debugConfig: config, lastDebugServerPort: config.port };
  };

  const applyMode = async (nextMode: ModeId, ctx: ExtensionContext, shouldPersist = true): Promise<void> => {
    const { nextTools, nextSavedTools } = computeActiveToolsForMode(nextMode, pi.getActiveTools(), state.toolsBeforeRestricted);
    pi.setActiveTools(nextTools);
    state = {
      ...state,
      mode: nextMode,
      toolsBeforeRestricted: nextSavedTools,
      pendingPlanSuggestion: nextMode === 'plan' ? state.pendingPlanSuggestion : false,
      planExecuting: nextMode === 'agent' ? state.planExecuting : false,
    };
    if (nextMode === 'debug') {
      await ensureDebugConfig(ctx);
    }
    syncModeUi(ctx, state);
    poller.sync(ctx);
    if (shouldPersist) {
      persist();
    }
  };

  const ctrl: ModeRuntimeController = {
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    persist,
    ensureDebugConfig,
    applyMode,
    reviewExistingPlan: (ctx) => reviewPlanNow(pi, ctrl, ctx),
    stopDebugServer: async () => {
      poller.stop();
      await debugServer.stop();
    },
  };

  return ctrl;
}

async function handleAgentEnd(pi: ExtensionAPI, ctrl: ModeRuntimeController, messages: readonly AgentMessage[], ctx: ExtensionContext): Promise<void> {
  const state = ctrl.getState();
  const lastAssistant = [...messages].toReversed().find(isAssistantMessage);
  const lastText = lastAssistant ? getAssistantText(lastAssistant) : '';

  if (state.planExecuting && state.planSteps.length > ZERO) {
    const nextSteps = advancePlanSteps(lastText, state.planSteps);
    if (nextSteps.every((step) => step.completed)) {
      const completedList = nextSteps.map((step) => `~~${step.text}~~`).join('\n');
      pi.sendMessage({ customType: PLAN_COMPLETE_CUSTOM_TYPE, content: `**Plan Complete!** ✓\n\n${completedList}`, display: true }, { deliverAs: 'nextTurn' });
      ctrl.setState({ ...state, planExecuting: false, planSteps: [] });
      syncModeUi(ctx, ctrl.getState());
      ctrl.persist();
    }
    return;
  }

  if (state.mode === 'plan' && state.pendingPlanSuggestion && state.currentPlanUri && ctx.hasUI) {
    await ctrl.reviewExistingPlan(ctx);
    return;
  }

  if (state.mode === 'debug' && ctx.hasUI) {
    const { reproductionSteps } = extractReproductionSteps(lastText);
    if (!reproductionSteps) {
      return;
    }
    const decision = await promptDebugDecision(ctx, reproductionSteps);
    if (decision.action === 'proceed') {
      pi.sendUserMessage(DEBUG_PROCEED_MESSAGE, { deliverAs: 'followUp' });
    } else if (decision.action === 'mark-fixed') {
      await ctrl.applyMode('agent', ctx);
      pi.sendUserMessage(DEBUG_MARK_FIXED_MESSAGE, { deliverAs: 'followUp' });
    } else if (decision.action === 'follow-up' && decision.followUp) {
      pi.sendUserMessage(decision.followUp, { deliverAs: 'followUp' });
    }
  }
}

function registerLifecycleEvents(pi: ExtensionAPI, ctrl: ModeRuntimeController): void {
  pi.on('tool_call', async (event) => evaluateToolCallGuard(ctrl.getState().mode, event));

  pi.on('context', async (event) => ({
    messages: event.messages.filter((msg) => !isStaleModeContextMessage(msg)),
  }));

  pi.on('before_agent_start', async (event, ctx) => {
    if (event.messageType !== 'user') {
      return undefined;
    }
    if (ctrl.getState().mode === 'debug') {
      await ctrl.ensureDebugConfig(ctx);
      syncModeUi(ctx, ctrl.getState());
      ctrl.persist();
    }
    const content = buildModeContextMessage(ctrl.getState());
    return content ? { message: { customType: MODE_CONTEXT_CUSTOM_TYPE, content, display: false } } : undefined;
  });

  pi.on('turn_end', async (event, ctx) => {
    const state = ctrl.getState();
    if (state.mode === 'debug') {
      syncModeUi(ctx, state);
    }
    if (!state.planExecuting || state.planSteps.length === ZERO || !isAssistantMessage(event.message)) {
      return;
    }
    ctrl.setState({ ...state, planSteps: applyCompletedSteps(getAssistantText(event.message), state.planSteps) });
    syncModeUi(ctx, ctrl.getState());
    ctrl.persist();
  });

  pi.on('agent_end', async (event, ctx) => {
    await handleAgentEnd(pi, ctrl, event.messages, ctx);
  });

  pi.on('session_start', async (_event, ctx) => {
    const restored = restoreStateFromSession(ctx);
    const targetMode = readInitialModeFromFlags(pi) ?? restored.mode;
    ctrl.setState(restored);
    await ctrl.applyMode(targetMode, ctx, false);
  });

  pi.on('session_shutdown', async () => {
    await ctrl.stopDebugServer();
  });
}

function registerModeShortcuts(pi: ExtensionAPI, ctrl: ModeRuntimeController): void {
  const onCycle = async (ctx: ExtensionContext): Promise<void> => {
    const next = getNextMode(ctrl.getState().mode);
    await ctrl.applyMode(next, ctx);
    ctx.ui.notify(`Mode: ${formatModeLabel(next)}`, 'info');
  };

  const onTogglePlan = async (ctx: ExtensionContext): Promise<void> => {
    const next: ModeId = ctrl.getState().mode === 'plan' ? 'agent' : 'plan';
    await ctrl.applyMode(next, ctx);
    ctx.ui.notify(`Mode: ${formatModeLabel(next)}`, 'info');
  };

  pi.registerShortcut(Key.ctrlAlt('m'), {
    description: 'Cycle execution mode (Agent → Plan → Debug → Ask)',
    handler: onCycle,
  });

  pi.registerShortcut(Key.ctrlAlt('p'), {
    description: 'Toggle Plan mode (read-only planning)',
    handler: onTogglePlan,
  });
}

export default function piModesExtension(pi: ExtensionAPI): void {
  const ctrl = createRuntimeController(pi);

  pi.registerFlag('mode', { description: 'Start in a specific mode: agent, plan, debug, or ask', type: 'string' });
  pi.registerFlag('plan', { description: 'Start in Plan mode (shorthand for --mode=plan)', type: 'boolean', default: false });

  registerModeShortcuts(pi, ctrl);

  registerModeTools(pi, {
    getState: ctrl.getState,
    switchMode: ctrl.applyMode,
    onPlanCreated: (planUri, steps, ctx) => {
      ctrl.setState({ ...ctrl.getState(), currentPlanUri: planUri, pendingPlanSuggestion: true, planSteps: steps });
      syncModeUi(ctx, ctrl.getState());
      ctrl.persist();
    },
  });

  registerModeCommands(pi, {
    getState: ctrl.getState,
    switchMode: ctrl.applyMode,
    reviewExistingPlan: ctrl.reviewExistingPlan,
  });

  registerLifecycleEvents(pi, ctrl);
}
