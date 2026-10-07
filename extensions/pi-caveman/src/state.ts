import { canonicalMode, type DefaultMode, isIndependentMode, type Mode, type StoredMode } from './modes.ts';
import type { ModeChange } from './parse.ts';

export const MODE_ENTRY = 'caveman-mode';

export interface ModeState {
  readonly mode: StoredMode;
  readonly returnTo: StoredMode | null;
}

export interface ModeEntry {
  readonly type: string;
  readonly customType?: string;
  readonly data?: unknown;
  readonly timestamp: string;
}

export interface ModeTransition {
  readonly ts: number;
  readonly mode: Mode | null;
  readonly prev: Mode | null;
}

export type PromptOutcome = { readonly kind: 'status'; readonly report: string } | { readonly kind: 'applied'; readonly next: ModeState; readonly notice: string | null };

export const OFF: ModeState = { mode: 'off', returnTo: null };

export function activeMode(state: ModeState): Mode | null {
  return state.mode === 'off' ? null : state.mode;
}

export function parseModeState(data: unknown): ModeState | null {
  if (typeof data !== 'object' || data === null || !('mode' in data)) return null;
  const mode = canonicalMode(data.mode);
  if (!mode) return null;
  const returnTo = 'returnTo' in data ? canonicalMode(data.returnTo) : null;
  return { mode, returnTo };
}

export function stateFromEntries(entries: readonly ModeEntry[]): ModeState | null {
  let state: ModeState | null = null;
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === MODE_ENTRY) state = parseModeState(entry.data) ?? state;
  }
  return state;
}

export function transitionsFromEntries(entries: readonly ModeEntry[]): ModeTransition[] {
  const transitions: ModeTransition[] = [];
  let prev: Mode | null = null;
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== MODE_ENTRY) continue;
    const state = parseModeState(entry.data);
    const ts = Date.parse(entry.timestamp);
    if (!state || !Number.isFinite(ts)) continue;
    const mode = activeMode(state);
    if (mode !== prev) transitions.push({ ts, mode, prev });
    prev = mode;
  }
  return transitions;
}

export function initialState(defaultMode: DefaultMode): ModeState {
  return defaultMode === 'off' || defaultMode === 'manual' ? OFF : { mode: defaultMode, returnTo: null };
}

function unresolvedNotice(change: Extract<ModeChange, { action: 'unresolved' }>): string {
  if (change.independentMode) {
    const mode = change.independentMode;
    return `Tell the user ${mode} mode is set with its own command, /caveman-${mode}, not /caveman ${mode}. The mode is unchanged.`;
  }
  return 'Tell the user their /caveman argument was not recognized and the mode is unchanged. Modes: /caveman, /ultracave, /megacave. Use /caveman off to deactivate.';
}

function applyChange(state: ModeState, change: ModeChange | null): { state: ModeState; setOneShot: boolean } {
  if (change?.action === 'clear') return { state: OFF, setOneShot: false };
  if (change?.action !== 'set') return { state, setOneShot: false };
  const before = activeMode(state);
  if (isIndependentMode(change.mode)) {
    const returnTo = before === null ? 'off' : isIndependentMode(before) ? state.returnTo : before;
    return { state: { mode: change.mode, returnTo }, setOneShot: true };
  }
  return { state: { mode: change.mode, returnTo: null }, setOneShot: false };
}

function restoreAfterOneShot(state: ModeState): ModeState {
  const mode = activeMode(state);
  if (mode === null || !isIndependentMode(mode)) return state;
  const back = state.returnTo;
  return back !== null && back !== 'off' && !isIndependentMode(back) ? { mode: back, returnTo: null } : OFF;
}

export function applyPrompt(state: ModeState, change: ModeChange | null): PromptOutcome {
  if (change?.action === 'status') return { kind: 'status', report: `Caveman mode: ${activeMode(state) ?? 'off'}` };
  const applied = applyChange(state, change);
  const next = applied.setOneShot ? applied.state : restoreAfterOneShot(applied.state);
  const notice = change?.action === 'unresolved' ? unresolvedNotice(change) : null;
  return { kind: 'applied', next, notice };
}

export function sameState(a: ModeState, b: ModeState): boolean {
  return a.mode === b.mode && a.returnTo === b.returnTo;
}
