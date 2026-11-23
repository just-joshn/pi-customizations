import { describe, expect, it } from 'vitest';
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
} from '../src/state.ts';
import { type CustomModeSkill, MODE_IDS, MODE_TOOL_NAMES, type ModeId, READ_ONLY_ALLOWED_TOOLS } from '../src/types.ts';
import { double } from './harness.ts';

const FULL_TOOLS = ['read', 'bash', 'edit', 'write', 'switch_mode', 'ask_question', 'create_plan', 'powershell'];

function makeSkill(overrides: Partial<CustomModeSkill> = {}): CustomModeSkill {
  return {
    id: 'reviewer',
    label: 'Reviewer',
    filePath: '/repo/.pi/skills/reviewer/SKILL.md',
    description: 'Reviews diffs',
    colorId: 'cyan',
    body: 'Review every diff.',
    ...overrides,
  };
}

function activeAskState(): ReturnType<typeof markCustomModeActive> & {
  mode: 'ask';
  toolsBeforeRestricted: readonly string[];
  currentPlanUri: string;
  pendingPlanSuggestion: true;
} {
  const active = markCustomModeActive(enterCustomMode(createInitialState(), makeSkill()));
  return { ...active, mode: 'ask', toolsBeforeRestricted: ['read', 'bash'], currentPlanUri: 'file:///tmp/plan.plan.md', pendingPlanSuggestion: true };
}

describe('canonicalModeName', () => {
  it('resolves only canonical names for startup and slash-command dispatch', () => {
    expect(canonicalModeName(' Ask ')).toBe('ask');
    expect(canonicalModeName('PLAN')).toBe('plan');
    expect(canonicalModeName('chat')).toBeUndefined();
    expect(canonicalModeName('reviewer')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(canonicalModeName('')).toBeUndefined();
  });
});

describe('normalizeModeAlias', () => {
  it('resolves the compatibility aliases separately from canonical names', () => {
    expect(normalizeModeAlias('chat')).toBe('ask');
    expect(normalizeModeAlias(' search ')).toBe('ask');
    expect(normalizeModeAlias('default')).toBe('agent');
    expect(normalizeModeAlias('agent')).toBe('agent');
    expect(normalizeModeAlias('reviewer')).toBeUndefined();
  });

  it('rejects a whitespace-only alias', () => {
    expect(normalizeModeAlias('   ')).toBeUndefined();
  });
});

describe('formatModeLabel', () => {
  it('labels every mode', () => {
    expect(MODE_IDS.map(formatModeLabel)).toEqual(['Agent', 'Plan', 'Debug', 'Ask']);
  });
});

describe('getNextMode', () => {
  it('cycles in the documented order', () => {
    expect(getNextMode('agent')).toBe('plan');
    expect(getNextMode('plan')).toBe('debug');
    expect(getNextMode('debug')).toBe('ask');
    expect(getNextMode('ask')).toBe('agent');
  });

  it('falls back to agent for an unknown mode', () => {
    expect(getNextMode(double<ModeId>('unknown'))).toBe('agent');
  });
});

describe('isReadOnlyMode', () => {
  it('marks only Ask and Plan as read-only', () => {
    expect(MODE_IDS.filter(isReadOnlyMode)).toEqual(['plan', 'ask']);
  });
});

describe('computeActiveToolsForMode', () => {
  it('keeps only the allowlist and the mode tools in Ask mode', () => {
    const { nextTools, nextSavedTools } = computeActiveToolsForMode('ask', FULL_TOOLS, undefined);

    expect(nextTools).toEqual(['read', 'bash', 'switch_mode', 'ask_question']);
    expect(nextSavedTools).toEqual(FULL_TOOLS);
  });

  it('adds create_plan in Plan mode', () => {
    const plan = computeActiveToolsForMode('plan', FULL_TOOLS, undefined);
    expect(plan.nextTools).toContain(MODE_TOOL_NAMES.createPlan);
  });

  it('removes create_plan when returning to Agent', () => {
    const plan = computeActiveToolsForMode('plan', FULL_TOOLS, undefined);
    const agent = computeActiveToolsForMode('agent', plan.nextTools, plan.nextSavedTools);
    expect(agent.nextTools).not.toContain(MODE_TOOL_NAMES.createPlan);
    expect(agent.nextTools).toContain('edit');
    expect(agent.nextTools).toContain('write');
  });

  it('keeps a tool registered during a read-only mode in the baseline and restores it', () => {
    const readOnly = computeActiveToolsForMode('ask', [...FULL_TOOLS, 'mcp__docs__write_file'], undefined);
    expect(readOnly.nextTools).not.toContain('mcp__docs__write_file');
    expect(readOnly.nextSavedTools).toContain('mcp__docs__write_file');

    const restored = computeActiveToolsForMode('agent', readOnly.nextTools, readOnly.nextSavedTools);
    expect(restored.nextTools).toContain('mcp__docs__write_file');
    expect(restored.nextTools).toContain('edit');
    expect(restored.nextSavedTools).toBeUndefined();
  });

  it('keeps switch_mode and ask_question when Debug starts with no tools', () => {
    expect(computeActiveToolsForMode('debug', [], undefined)).toEqual({
      nextTools: ['switch_mode', 'ask_question'],
      nextSavedTools: undefined,
    });
  });
});

describe('READ_ONLY_ALLOWED_TOOLS', () => {
  it('excludes every write-capable tool from the read-only allowlist', () => {
    for (const name of ['edit', 'write', 'powershell', 'mcp__docs__write_file', 'unknown_writer']) {
      expect(READ_ONLY_ALLOWED_TOOLS.has(name)).toBe(false);
    }
    expect(READ_ONLY_ALLOWED_TOOLS.has('read')).toBe(true);
    expect(READ_ONLY_ALLOWED_TOOLS.has('bash')).toBe(true);
  });
});

describe('enterCustomMode', () => {
  it('enters a custom mode in the entered lifecycle', () => {
    const entered = enterCustomMode(createInitialState(), makeSkill());
    expect(entered.customMode?.lifecycle).toBe('entered');
  });

  it('records the previous active mode when switching directly to another custom mode', () => {
    const active = markCustomModeActive(enterCustomMode(createInitialState(), makeSkill()));
    const switched = enterCustomMode(active, makeSkill({ id: 'planner', label: 'Planner' }));

    expect(switched.customMode?.id).toBe('planner');
    expect(switched.pendingExitedCustomMode).toEqual({ id: 'reviewer', label: 'Reviewer' });
  });
});

describe('markCustomModeActive', () => {
  it('marks an entered mode active', () => {
    const entered = enterCustomMode(createInitialState(), makeSkill());
    expect(markCustomModeActive(entered).customMode?.lifecycle).toBe('active');
  });

  it('returns the same state when the custom mode is already active', () => {
    const active = markCustomModeActive(enterCustomMode(createInitialState(), makeSkill()));
    expect(markCustomModeActive(active)).toBe(active);
  });
});

describe('exitCustomMode', () => {
  it('clears the custom mode and keeps an exit notice after an active mode', () => {
    const active = markCustomModeActive(enterCustomMode(createInitialState(), makeSkill()));
    const exited = exitCustomMode(active);
    expect(exited.customMode).toBeUndefined();
    expect(exited.pendingExitedCustomMode).toEqual({ id: 'reviewer', label: 'Reviewer' });
  });

  it('is a no-op without a custom mode', () => {
    const initial = createInitialState();
    expect(exitCustomMode(initial)).toBe(initial);
  });

  it('does not claim an exit notice when a mode was entered but never ran', () => {
    const entered = enterCustomMode(createInitialState(), makeSkill());
    const exited = exitCustomMode(entered);
    expect(exited.pendingExitedCustomMode).toBeUndefined();
  });
});

describe('clearPendingExitedCustomMode', () => {
  it('clears a pending exit notice', () => {
    const active = markCustomModeActive(enterCustomMode(createInitialState(), makeSkill()));
    const cleared = clearPendingExitedCustomMode(exitCustomMode(active));
    expect(cleared.pendingExitedCustomMode).toBeUndefined();
  });

  it('is a no-op when no exit notice is pending', () => {
    const initial = createInitialState();
    expect(clearPendingExitedCustomMode(initial)).toBe(initial);
  });
});

describe('toPersistedState', () => {
  it('persists the durable mode state and drops run-scoped fields', () => {
    const state = activeAskState();
    const persisted = toPersistedState(state);
    expect(persisted).not.toHaveProperty('pendingPlanSuggestion');
    expect(persisted.customMode).toEqual(state.customMode);
  });
});

describe('restorePersistedState', () => {
  it('restores the durable mode state and resets run-scoped fields', () => {
    const state = activeAskState();
    const restored = restorePersistedState(toPersistedState(state));
    expect(restored.mode).toBe('ask');
    expect(restored.toolsBeforeRestricted).toEqual(['read', 'bash']);
    expect(restored.currentPlanUri).toBe('file:///tmp/plan.plan.md');
    expect(restored.customMode).toEqual(state.customMode);
    expect(restored.pendingPlanSuggestion).toBe(false);
  });

  it('fills omitted optional fields with empty runtime defaults', () => {
    expect(restorePersistedState({ mode: 'agent' })).toEqual({
      mode: 'agent',
      toolsBeforeRestricted: undefined,
      currentPlanUri: undefined,
      pendingPlanSuggestion: false,
      planExecuting: false,
      planSteps: [],
      lastDebugServerPort: undefined,
      debugConfig: undefined,
      customMode: undefined,
      pendingExitedCustomMode: undefined,
    });
  });
});
