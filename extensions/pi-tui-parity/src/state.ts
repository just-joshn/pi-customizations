/**
 * Session-scoped Reference mode state shared by the editor, footer, decision gate,
 * and commands. Reference sources: source-composer.md §3 (headline), §8 (modes),
 * §9 (vim indicators); source-screens.md §1 (/run-everything, /auto-review).
 */

import type { HexColor } from './palette.ts';

export type TuiMode = 'default' | 'plan' | 'ask' | 'debug' | (string & {});

export interface CustomMode {
  readonly id: string;
  readonly label: string;
  readonly color: HexColor;
}

export type VimState = 'insert' | 'normal' | 'visual';

export interface TuiSessionState {
  readonly mode: TuiMode;
  readonly customMode: CustomMode | undefined;
  readonly runEverything: boolean;
  readonly autoReview: boolean;
  readonly vim: VimState;
  readonly compact: boolean;
}

export type SessionAction =
  | { readonly type: 'cycleMode' }
  | { readonly type: 'setMode'; readonly mode: TuiMode }
  | { readonly type: 'toggleAsk' }
  | { readonly type: 'toggleVim' }
  | { readonly type: 'setVim'; readonly vim: VimState }
  | { readonly type: 'toggleRunEverything' }
  | { readonly type: 'toggleAutoReview' }
  | { readonly type: 'toggleCompact' };

export interface FooterHeadline {
  readonly text: string;
  readonly color: HexColor;
  readonly inverseFocus: boolean;
}

export function modeHeadline(state: TuiSessionState, width: number): FooterHeadline | undefined {
  if (state.customMode) {
    return { text: `${state.customMode.label} (shift+tab to exit)`, color: state.customMode.color, inverseFocus: false };
  }
  if (width > 0 && state.runEverything) {
    return undefined;
  }
  switch (state.mode) {
    case 'plan':
      return { text: 'Plan (shift+tab to cycle)', color: '#F4E7A1', inverseFocus: false };
    case 'ask':
      return { text: 'Ask (shift+tab to cycle)', color: '#58D68D', inverseFocus: false };
    case 'debug':
      return { text: 'Debug (shift+tab to cycle)', color: '#E34671', inverseFocus: false };
    default:
      return undefined;
  }
}

export function autorunLabel(state: TuiSessionState): string | undefined {
  if (state.runEverything) return 'Run Everything';
  if (state.autoReview) return 'Auto-review';
  return undefined;
}

export function vimFooterLabel(state: TuiSessionState): string | undefined {
  if (state.vim === 'normal') return undefined;
  return state.vim === 'visual' ? '-- VISUAL --' : '-- INSERT --';
}

export const MODE_CYCLE: readonly TuiMode[] = ['default', 'plan', 'debug', 'ask'];

export function createSessionState(overrides: Partial<TuiSessionState> = {}): TuiSessionState {
  return {
    mode: 'default',
    customMode: undefined,
    runEverything: false,
    autoReview: false,
    vim: 'insert',
    compact: true,
    ...overrides,
  };
}

export function nextMode(current: TuiMode): TuiMode {
  const idx = MODE_CYCLE.indexOf(current);
  return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
}

export function reduceSession(state: TuiSessionState, action: SessionAction): TuiSessionState {
  switch (action.type) {
    case 'cycleMode':
      return { ...state, mode: nextMode(state.mode) };
    case 'setMode':
      return { ...state, mode: action.mode };
    case 'toggleAsk':
      return { ...state, mode: state.mode === 'ask' ? 'default' : 'ask' };
    case 'toggleVim':
      return { ...state, vim: state.vim === 'normal' ? 'insert' : 'normal' };
    case 'setVim':
      return { ...state, vim: action.vim };
    case 'toggleRunEverything':
      return { ...state, runEverything: !state.runEverything };
    case 'toggleAutoReview':
      return { ...state, autoReview: !state.autoReview };
    case 'toggleCompact':
      return { ...state, compact: !state.compact };
  }
}

export interface SessionReader {
  read(): TuiSessionState;
}

export interface TuiSession extends SessionReader {
  dispatch(action: SessionAction): TuiSessionState;
}

export function createSession(initial: TuiSessionState = createSessionState()): TuiSession {
  let current = initial;
  return {
    read: () => current,
    dispatch: (action) => {
      current = reduceSession(current, action);
      return current;
    },
  };
}
