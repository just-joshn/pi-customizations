import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { type ExtensionAPI, type ExtensionContext, isToolCallEventType, type SessionEntry, type ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { Key } from '@earendil-works/pi-tui';
import { registerModeCommands } from './commands.ts';
import { buildCustomModeMessage, buildSkillReferenceMessage, type CustomModeContextMessage, findCustomMode, listCustomModes, referencesSkill } from './custom-modes.ts';
import { createDebugServerController } from './debug-server.ts';
import { readPlanFileFromUri } from './plan-files.ts';
import { advancePlanSteps, applyCompletedSteps, extractStepsFromMarkdown } from './plan-progress.ts';
import { buildModeContextMessage } from './prompts.ts';
import { extractReproductionSteps } from './reproduction-steps.ts';
import { isSafeReadOnlyCommand } from './shell-guard.ts';
import { readSkillDocument, writeSkillAppearance } from './skill-frontmatter.ts';
import {
  canonicalModeName,
  clearPendingExitedCustomMode,
  computeActiveToolsForMode,
  createInitialState,
  enterCustomMode,
  exitCustomMode,
  formatModeLabel,
  getNextMode,
  isReadOnlyMode,
  markCustomModeActive,
  normalizeModeAlias,
  restorePersistedState,
  toPersistedState,
} from './state.ts';
import { registerModeTools } from './tools.ts';
import {
  CUSTOM_MODE_ENTERED_CUSTOM_TYPE,
  CUSTOM_MODE_REMINDER_CUSTOM_TYPE,
  type CustomModeAppearancePatch,
  type CustomModeSkill,
  ENTRY_CUSTOM_TYPE,
  MODE_CONTEXT_CUSTOM_TYPE,
  MODE_PROMPT_CUSTOM_TYPE,
  type ModeId,
  type ModeInjectionDetails,
  type ModesRuntimeState,
  ONE,
  PersistedModeStateSchema,
  PLAN_COMPLETE_CUSTOM_TYPE,
  PLAN_EXECUTE_CUSTOM_TYPE,
  READ_ONLY_ALLOWED_TOOLS,
  SKILL_REFERENCE_CUSTOM_TYPE,
  type TrackedPlanStep,
  ZERO,
} from './types.ts';
import { DEBUG_MARK_FIXED_MESSAGE, DEBUG_PROCEED_MESSAGE, promptDebugDecision, promptPlanDecision, syncModeUi } from './ui-flows.ts';

const MODE_CONTEXT_CUSTOM_TYPES = new Set<string>([MODE_CONTEXT_CUSTOM_TYPE, CUSTOM_MODE_ENTERED_CUSTOM_TYPE, CUSTOM_MODE_REMINDER_CUSTOM_TYPE, SKILL_REFERENCE_CUSTOM_TYPE]);
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

/**
 * Injections belong to the run that emitted them. Pi keeps one run alive across tool rounds and
 * across steered or follow-up user messages, so pruning by position would delete the guidance
 * exactly when a follow-up is queued. The run nonce keeps them for the whole run and drops every
 * earlier turn's copy, with no text heuristics over user content.
 */
function isStaleModeContextMessage(message: AgentMessage, runId: string | undefined): boolean {
  const customType = 'customType' in message && typeof message.customType === 'string' ? message.customType : undefined;
  if (customType === undefined || !MODE_CONTEXT_CUSTOM_TYPES.has(customType)) {
    return false;
  }
  return !isCurrentRunInjection(message, runId);
}

function isCurrentRunInjection(message: AgentMessage, runId: string | undefined): boolean {
  if (runId === undefined) {
    return false;
  }
  const customType = 'customType' in message && typeof message.customType === 'string' ? message.customType : undefined;
  if (customType === undefined || !MODE_CONTEXT_CUSTOM_TYPES.has(customType)) {
    return false;
  }
  const details = 'details' in message ? (message.details as Partial<ModeInjectionDetails> | undefined) : undefined;
  return details?.runId === runId;
}

interface RunGuidance {
  readonly id: string;
  readonly custom: CustomModeContextMessage | undefined;
  readonly skill: CustomModeContextMessage | undefined;
}

function buildExecutionGuidance(state: ModesRuntimeState): CustomModeContextMessage | undefined {
  const content = buildModeContextMessage(state);
  return content === undefined ? undefined : { customType: MODE_CONTEXT_CUSTOM_TYPE, content, display: false };
}

function tagGuidance(draft: CustomModeContextMessage, run: RunGuidance) {
  return { ...draft, details: { runId: run.id } };
}

function evaluateToolCallGuard(mode: ModeId, event: ToolCallEvent): { block: true; reason: string } | undefined {
  if (!isReadOnlyMode(mode)) {
    return undefined;
  }
  if (!READ_ONLY_ALLOWED_TOOLS.has(event.toolName)) {
    return { block: true, reason: `${formatModeLabel(mode)} mode is read-only. ${event.toolName} is not available. Switch to Agent mode before editing files.` };
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

function readInitialCustomModeFlag(pi: ExtensionAPI): string | undefined {
  const modeFlag = pi.getFlag('mode');
  return typeof modeFlag === 'string' && modeFlag.trim().length > ZERO ? modeFlag.trim() : undefined;
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

function readSessionState(ctx: ExtensionContext): { state: ModesRuntimeState; baseline?: string } {
  const entries = ctx.sessionManager.getEntries();
  const lastEntry = entries.filter((entry) => entry.type === 'custom' && 'customType' in entry && entry.customType === ENTRY_CUSTOM_TYPE).at(-ONE);
  if (!lastEntry || !('data' in lastEntry)) {
    return { state: createInitialState() };
  }
  const parsed = PersistedModeStateSchema.safeParse(lastEntry.data);
  if (!parsed.success) {
    return { state: createInitialState() };
  }
  const restored = restorePersistedState(parsed.data);
  const baseline = JSON.stringify(toPersistedState(restored));
  if (!restored.planExecuting || restored.planSteps.length === ZERO) {
    return { state: restored, baseline };
  }
  const reconciled = reconcileResumedPlanSteps(entries, restored.planSteps);
  if (reconciled.every((step) => step.completed)) {
    return { state: { ...restored, planExecuting: false, planSteps: [] }, baseline };
  }
  return { state: { ...restored, planSteps: reconciled }, baseline };
}

interface ModeRuntimeController {
  readonly getState: () => ModesRuntimeState;
  readonly setState: (next: ModesRuntimeState) => void;
  readonly persist: () => void;
  readonly restoreSession: (ctx: ExtensionContext) => ModesRuntimeState;
  readonly getRun: () => RunGuidance | undefined;
  readonly setRun: (run: RunGuidance) => void;
  readonly ensureDebugConfig: (ctx: ExtensionContext) => Promise<void>;
  readonly applyMode: (nextMode: ModeId, ctx: ExtensionContext, shouldPersist?: boolean) => Promise<void>;
  readonly reviewExistingPlan: (ctx: ExtensionContext) => Promise<void>;
  readonly stopDebugServer: () => Promise<void>;
  readonly listCustomModes: () => Promise<readonly CustomModeSkill[]>;
  readonly enterCustomMode: (skill: CustomModeSkill, ctx: ExtensionContext) => Promise<void>;
  readonly exitCustomMode: (ctx: ExtensionContext) => Promise<void>;
  readonly setCustomModeAppearance: (patch: CustomModeAppearancePatch, ctx: ExtensionContext) => Promise<void>;
  readonly reapplyToolLoadout: () => void;
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
  let lastPersisted: string | undefined;
  let run: RunGuidance | undefined;
  const debugServer = createDebugServerController();
  const poller = createDebugPoller(() => state);

  const persist = (): void => {
    const persisted = toPersistedState(state);
    const serialized = JSON.stringify(persisted);
    if (serialized === lastPersisted) {
      return;
    }
    lastPersisted = serialized;
    pi.appendEntry(ENTRY_CUSTOM_TYPE, persisted);
  };

  /** Re-assert the mode's loadout so a tool registered mid-mode cannot stay offered. */
  const reapplyToolLoadout = (): void => {
    const current = pi.getActiveTools();
    const { nextTools, nextSavedTools } = computeActiveToolsForMode(state.mode, current, state.toolsBeforeRestricted);
    const unchanged = current.length === nextTools.length && current.every((name, index) => name === nextTools[index]);
    if (!unchanged) {
      pi.setActiveTools(nextTools);
    }
    state = { ...state, toolsBeforeRestricted: nextSavedTools };
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
    if (run !== undefined) {
      run = { ...run, id: randomUUID() };
    }
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
    restoreSession: (ctx) => {
      const restored = readSessionState(ctx);
      state = restored.state;
      lastPersisted = restored.baseline;
      run = undefined;
      return state;
    },
    getRun: () => run,
    setRun: (next) => {
      run = next;
    },
    ensureDebugConfig,
    applyMode,
    reviewExistingPlan: (ctx) => reviewPlanNow(pi, ctrl, ctx),
    stopDebugServer: async () => {
      poller.stop();
      await debugServer.stop();
    },
    listCustomModes: async () => listCustomModes(pi.getCommands()),
    reapplyToolLoadout,
    enterCustomMode: async (skill, ctx) => {
      state = enterCustomMode(state, skill);
      if (run !== undefined) {
        run = { ...run, id: randomUUID(), custom: undefined };
      }
      syncModeUi(ctx, state);
      persist();
      ctx.ui.notify(`${skill.label} custom mode enabled.`, 'info');
    },
    exitCustomMode: async (ctx) => {
      if (state.customMode === undefined) {
        ctx.ui.notify('No custom mode is active.', 'info');
        return;
      }
      const label = state.customMode.label;
      state = exitCustomMode(state);
      if (run !== undefined) {
        run = { ...run, id: randomUUID(), custom: undefined };
      }
      syncModeUi(ctx, state);
      persist();
      ctx.ui.notify(`${label} custom mode disabled.`, 'info');
    },
    setCustomModeAppearance: async (patch, ctx) => {
      const active = state.customMode;
      if (active === undefined) {
        return;
      }
      const skill = pi.getCommands().find((command) => command.source === 'skill' && command.sourceInfo.path === active.filePath);
      if (skill === undefined) {
        ctx.ui.notify(`Pi no longer discovers the ${active.label} skill. Its appearance was not changed.`, 'warning');
        return;
      }
      try {
        await writeSkillAppearance(active.filePath, patch, skill.sourceInfo.path);
        const document = await readSkillDocument(active.filePath, active.id);
        state = { ...state, customMode: { ...active, name: document.name, label: document.label, icon: document.icon, colorId: document.colorId, body: document.body } };
        syncModeUi(ctx, state);
        persist();
        ctx.ui.notify(`${document.label} mode appearance updated.`, 'info');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not update the ${active.label} mode appearance: ${reason}`, 'error');
      }
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

function prepareCustomGuidance(ctrl: ModeRuntimeController, ctx: ExtensionContext, run: RunGuidance): CustomModeContextMessage | undefined {
  if (run.custom !== undefined) {
    return run.custom;
  }
  const current = ctrl.getState();
  const message = buildCustomModeMessage({ active: current.customMode, pendingExited: current.pendingExitedCustomMode });
  if (message === undefined) {
    return undefined;
  }
  ctrl.setRun({ ...run, custom: message });
  ctrl.setState(markCustomModeActive(clearPendingExitedCustomMode(current)));
  ctrl.persist();
  syncModeUi(ctx, ctrl.getState());
  return message;
}

function registerLifecycleEvents(pi: ExtensionAPI, ctrl: ModeRuntimeController): void {
  pi.on('tool_call', async (event) => evaluateToolCallGuard(ctrl.getState().mode, event));

  pi.on('context', async (event, ctx) => {
    const run = ctrl.getRun();
    const filtered = event.messages.filter((message) => !isStaleModeContextMessage(message, run?.id));
    if (run === undefined) {
      return { messages: filtered };
    }
    const presentTypes = new Set(filtered.flatMap((message) => (isCurrentRunInjection(message, run.id) && 'customType' in message ? [message.customType] : [])));
    const drafts = [buildExecutionGuidance(ctrl.getState()), prepareCustomGuidance(ctrl, ctx, run), run.skill];
    const timestamp = Date.now();
    const missing = drafts.flatMap((draft) => (draft !== undefined && !presentTypes.has(draft.customType) ? [{ role: 'custom' as const, ...tagGuidance(draft, run), timestamp }] : []));
    return { messages: [...filtered, ...missing] };
  });

  pi.on('before_agent_start', async (_event, ctx) => {
    ctrl.reapplyToolLoadout();
    const run = { id: randomUUID(), custom: undefined, skill: undefined };
    ctrl.setRun(run);
    if (ctrl.getState().mode === 'debug') {
      await ctrl.ensureDebugConfig(ctx);
      syncModeUi(ctx, ctrl.getState());
      ctrl.persist();
    }
    const message = buildExecutionGuidance(ctrl.getState());
    return message ? { message: tagGuidance(message, run) } : undefined;
  });

  pi.on('before_agent_start', async (_event, ctx) => {
    const run = ctrl.getRun();
    if (run === undefined) {
      return undefined;
    }
    const message = prepareCustomGuidance(ctrl, ctx, run);
    return message ? { message: tagGuidance(message, run) } : undefined;
  });

  pi.on('before_agent_start', async (event) => {
    const prompt = event.messageType === 'user' ? event.prompt : event.message.customType === MODE_PROMPT_CUSTOM_TYPE && typeof event.message.content === 'string' ? event.message.content : undefined;
    const run = ctrl.getRun();
    if (run === undefined || prompt === undefined || !referencesSkill(prompt)) {
      return undefined;
    }
    const active = ctrl.getState().customMode;
    const message = buildSkillReferenceMessage(prompt, await ctrl.listCustomModes(), active === undefined ? [] : [active.filePath]);
    if (message === undefined) {
      return undefined;
    }
    ctrl.setRun({ ...run, skill: message });
    return { message: tagGuidance(message, run) };
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
    const restored = ctrl.restoreSession(ctx);
    const flag = readInitialCustomModeFlag(pi);
    const planFlag = pi.getFlag('plan') === true;
    let startupBuiltin: ModeId | undefined = planFlag ? 'plan' : undefined;
    let startupCustom: CustomModeSkill | undefined;
    if (!planFlag && flag !== undefined) {
      // Canonical mode names are reserved; a custom name wins next, then the compatibility aliases.
      startupBuiltin = canonicalModeName(flag);
      if (startupBuiltin === undefined) {
        startupCustom = findCustomMode(await ctrl.listCustomModes(), flag);
        if (startupCustom === undefined) {
          startupBuiltin = normalizeModeAlias(flag);
        }
      }
    }
    if (flag !== undefined && startupBuiltin === undefined && startupCustom === undefined) {
      const warning = `Unknown mode ${JSON.stringify(flag)}. Use: agent, plan, debug, ask, or a skill-backed mode name.`;
      if (ctx.hasUI) {
        ctx.ui.notify(warning, 'warning');
      } else {
        process.stderr.write(`${warning}\n`);
      }
    }
    const withCustom = startupCustom === undefined ? restored : enterCustomMode(restored, startupCustom);
    ctrl.setState(withCustom);
    await ctrl.applyMode(startupBuiltin ?? withCustom.mode, ctx, false);
    if (startupCustom !== undefined) {
      ctrl.persist();
    }
  });

  pi.on('mcp_servers_change', async () => {
    ctrl.reapplyToolLoadout();
  });

  pi.on('session_shutdown', async () => {
    await ctrl.stopDebugServer();
  });
}

function registerModeShortcuts(pi: ExtensionAPI, ctrl: ModeRuntimeController): void {
  const onCycle = async (ctx: ExtensionContext): Promise<void> => {
    if (ctrl.getState().customMode !== undefined) {
      await ctrl.exitCustomMode(ctx);
      return;
    }
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
    listCustomModes: ctrl.listCustomModes,
    enterCustomMode: ctrl.enterCustomMode,
    exitCustomMode: ctrl.exitCustomMode,
    setCustomModeAppearance: ctrl.setCustomModeAppearance,
  });

  registerLifecycleEvents(pi, ctrl);
}
