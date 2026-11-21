import { DEFAULT_MODE, MODE_IDS, MODE_SPECS, MODE_TOOL_NAMES, type ModeId, type ModesRuntimeState, ONE, type PersistedModeState, READ_ONLY_DISABLED_TOOLS, type TrackedPlanStep, ZERO } from './types.ts';

const NOT_FOUND = -1;

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

export function computeActiveToolsForMode(mode: ModeId, currentTools: readonly string[], savedTools: readonly string[] | undefined): { nextTools: string[]; nextSavedTools: readonly string[] | undefined } {
  const spec = MODE_SPECS[mode];
  if (spec.readOnly) {
    const baseline = savedTools ?? currentTools;
    const allowed = baseline.filter((name) => !READ_ONLY_DISABLED_TOOLS.has(name) && (spec.includeCreatePlan || name !== MODE_TOOL_NAMES.createPlan));
    const extras: readonly string[] = spec.includeCreatePlan ? [MODE_TOOL_NAMES.createPlan, MODE_TOOL_NAMES.askQuestion, MODE_TOOL_NAMES.switchMode] : [MODE_TOOL_NAMES.switchMode];
    return { nextTools: [...new Set([...allowed, ...extras])], nextSavedTools: baseline };
  }

  const restored = savedTools ?? currentTools;
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
  };
}
