import type { ActiveCustomMode, CustomModeSkill, PendingExitedCustomMode } from './types.ts';
import { DEFAULT_MODE, MODE_IDS, MODE_SPECS, MODE_TOOL_NAMES, type ModeId, type ModesRuntimeState, ONE, type PersistedModeState, READ_ONLY_ALLOWED_TOOLS, type TrackedPlanStep, ZERO } from './types.ts';

const NOT_FOUND = -1;
const CUSTOM_MODE_LIFECYCLE_ENTERED = 'entered';
const CUSTOM_MODE_LIFECYCLE_ACTIVE = 'active';

const MODE_ALIASES: Readonly<Record<string, ModeId>> = {
  agent: 'agent',
  default: 'agent',
  plan: 'plan',
  debug: 'debug',
  ask: 'ask',
  search: 'ask',
  chat: 'ask',
};

export function createInitialState(): ModesRuntimeState {
  return {
    mode: DEFAULT_MODE,
    toolsBeforeRestricted: undefined,
    currentPlanUri: undefined,
    pendingPlanSuggestion: false,
    planExecuting: false,
    planSteps: [],
    lastDebugServerPort: undefined,
    debugConfig: undefined,
    customMode: undefined,
    pendingExitedCustomMode: undefined,
  };
}

export function isReadOnlyMode(mode: ModeId): boolean {
  return MODE_SPECS[mode].readOnly;
}

export function getNextMode(current: ModeId): ModeId {
  const index = MODE_IDS.indexOf(current);
  if (index === NOT_FOUND) {
    return DEFAULT_MODE;
  }
  return MODE_IDS[(index + ONE) % MODE_IDS.length] ?? DEFAULT_MODE;
}

export function formatModeLabel(mode: ModeId): string {
  return MODE_SPECS[mode].label;
}

export function normalizeModeAlias(raw: string): ModeId | undefined {
  return MODE_ALIASES[raw.trim().toLowerCase()];
}

export function canonicalModeName(raw: string): ModeId | undefined {
  const normalized = raw.trim().toLowerCase();
  return MODE_IDS.find((mode) => mode === normalized);
}

export function computeActiveToolsForMode(mode: ModeId, currentTools: readonly string[], savedTools: readonly string[] | undefined): { nextTools: string[]; nextSavedTools: readonly string[] | undefined } {
  const spec = MODE_SPECS[mode];
  if (spec.readOnly) {
    // Keep late-registered tools in the baseline so leaving the mode restores them.
    const baseline = [...new Set([...(savedTools ?? []), ...currentTools])];
    const allowed = baseline.filter((name) => READ_ONLY_ALLOWED_TOOLS.has(name) && (spec.includeCreatePlan || name !== MODE_TOOL_NAMES.createPlan));
    const extras: readonly string[] = spec.includeCreatePlan ? [MODE_TOOL_NAMES.createPlan, MODE_TOOL_NAMES.askQuestion, MODE_TOOL_NAMES.switchMode] : [MODE_TOOL_NAMES.switchMode];
    return { nextTools: [...new Set([...allowed, ...extras])], nextSavedTools: baseline };
  }

  const restored = [...new Set([...(savedTools ?? []), ...currentTools])];
  const withoutPlanOnly = restored.filter((name) => name !== MODE_TOOL_NAMES.createPlan);
  return {
    nextTools: [...new Set([...withoutPlanOnly, MODE_TOOL_NAMES.switchMode, MODE_TOOL_NAMES.askQuestion])],
    nextSavedTools: undefined,
  };
}

export function toPersistedState(state: ModesRuntimeState): PersistedModeState {
  return {
    mode: state.mode,
    planExecuting: state.planExecuting,
    planSteps: [...state.planSteps],
    ...(state.toolsBeforeRestricted !== undefined ? { toolsBeforeRestricted: [...state.toolsBeforeRestricted] } : {}),
    ...(state.currentPlanUri !== undefined ? { currentPlanUri: state.currentPlanUri } : {}),
    ...(state.lastDebugServerPort !== undefined ? { lastDebugServerPort: state.lastDebugServerPort } : {}),
    ...(state.customMode !== undefined ? { customMode: state.customMode } : {}),
    ...(state.pendingExitedCustomMode !== undefined ? { pendingExitedCustomMode: state.pendingExitedCustomMode } : {}),
  };
}

export function restorePersistedState(persisted: PersistedModeState): ModesRuntimeState {
  const steps: readonly TrackedPlanStep[] = persisted.planSteps ?? [];
  return {
    mode: persisted.mode,
    toolsBeforeRestricted: persisted.toolsBeforeRestricted,
    currentPlanUri: persisted.currentPlanUri,
    pendingPlanSuggestion: false,
    planExecuting: persisted.planExecuting ?? false,
    planSteps: steps.length > ZERO ? steps : [],
    lastDebugServerPort: persisted.lastDebugServerPort,
    debugConfig: undefined,
    customMode: persisted.customMode,
    pendingExitedCustomMode: persisted.pendingExitedCustomMode,
  };
}

function toPendingExited(mode: ActiveCustomMode): PendingExitedCustomMode {
  return { id: mode.id, label: mode.label };
}

function pendingExitedFrom(mode: ActiveCustomMode | undefined): PendingExitedCustomMode | undefined {
  return mode?.lifecycle === CUSTOM_MODE_LIFECYCLE_ACTIVE ? toPendingExited(mode) : undefined;
}

export function enterCustomMode(state: ModesRuntimeState, skill: CustomModeSkill): ModesRuntimeState {
  return {
    ...state,
    customMode: { ...skill, lifecycle: CUSTOM_MODE_LIFECYCLE_ENTERED },
    pendingExitedCustomMode: pendingExitedFrom(state.customMode) ?? state.pendingExitedCustomMode,
  };
}

export function markCustomModeActive(state: ModesRuntimeState): ModesRuntimeState {
  if (state.customMode === undefined || state.customMode.lifecycle === CUSTOM_MODE_LIFECYCLE_ACTIVE) {
    return state;
  }
  return { ...state, customMode: { ...state.customMode, lifecycle: CUSTOM_MODE_LIFECYCLE_ACTIVE } };
}

export function exitCustomMode(state: ModesRuntimeState): ModesRuntimeState {
  if (state.customMode === undefined) {
    return state;
  }
  return { ...state, customMode: undefined, pendingExitedCustomMode: pendingExitedFrom(state.customMode) ?? state.pendingExitedCustomMode };
}

export function clearPendingExitedCustomMode(state: ModesRuntimeState): ModesRuntimeState {
  return state.pendingExitedCustomMode === undefined ? state : { ...state, pendingExitedCustomMode: undefined };
}
