// Clarifying Questions panel: the Pi-native reproduction of the reference AskQuestion panel.
// Chrome and key semantics come from the captured reference journeys
// (parity/evidence/setup-prepair/cursor, parity/evidence/cursor-panel-probe); the design record
// is parity/designs/setup-parity-panel.md. The reducer and renderer are pure so the oracle stays
// unit-testable without a terminal.

import { matchesKey } from '@earendil-works/pi-tui';

export interface PanelOption {
  readonly id: string;
  readonly label: string;
}

export interface PanelQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly PanelOption[];
  readonly allowMultiple: boolean;
}

export interface PanelAnswer {
  readonly id: string;
  readonly answers: string[];
  readonly cancelled: boolean;
}

export type PanelInput = 'up' | 'down' | 'left' | 'right' | 'space' | 'enter' | 'escape' | 'backspace' | { readonly char: string };

export interface PanelState {
  readonly title: string;
  readonly questions: readonly PanelQuestion[];
  readonly index: number;
  readonly cursors: readonly number[];
  readonly selected: readonly (readonly number[])[];
  readonly texts: readonly (string | undefined)[];
  readonly textOpen: boolean;
  readonly text: string;
  readonly finished: boolean;
}

export interface PanelResult {
  readonly state: PanelState;
  readonly answers: readonly PanelAnswer[];
}

const blank = (question: PanelQuestion): PanelAnswer => ({ id: question.id, answers: [], cancelled: true });

export function initialPanelState(questions: readonly PanelQuestion[], title = 'Clarifying Questions'): PanelState {
  return {
    title,
    questions,
    index: 0,
    cursors: questions.map(() => 0),
    selected: questions.map(() => []),
    texts: questions.map(() => undefined),
    textOpen: false,
    text: '',
    finished: false,
  };
}

const withState = (state: PanelState, patch: Partial<PanelState>): PanelState => ({ ...state, ...patch });

const withQuestion = (state: PanelState, patch: { index?: number; cursor?: number; selected?: readonly number[]; text?: string | undefined }): PanelState => {
  const index = patch.index ?? state.index;
  const applyAt = <T>(values: readonly T[], value: T | undefined): readonly T[] =>
    value === undefined ? values : values.map((current, i) => (i === index ? value : current));
  return withState(state, {
    index,
    cursors: applyAt(state.cursors, patch.cursor),
    selected: applyAt(state.selected, patch.selected),
    texts: applyAt(state.texts, patch.text),
  });
};

function moveCursor(state: PanelState, delta: number): PanelState {
  const question = state.questions[state.index];
  if (!question) return state;
  const last = question.options.length;
  const cursor = Math.min(last, Math.max(0, (state.cursors[state.index] ?? 0) + delta));
  return withQuestion(state, { cursor });
}

function toggleSelection(state: PanelState): PanelState {
  const question = state.questions[state.index];
  const cursor = state.cursors[state.index];
  if (!question || cursor === undefined || cursor >= question.options.length) return state;
  const current = state.selected[state.index] ?? [];
  const next = current.includes(cursor) ? current.filter((value) => value !== cursor) : [...current, cursor].sort((a, b) => a - b);
  return withQuestion(state, { selected: next });
}

function advance(state: PanelState): PanelState {
  const last = state.questions.length - 1;
  if (state.index >= last) return withState(state, { finished: true });
  return withState(state, { index: state.index + 1, textOpen: false, text: '' });
}

export function reducePanel(state: PanelState, input: PanelInput): PanelState {
  if (state.finished) return state;
  if (state.textOpen) {
    if (input === 'escape') return withQuestion(withState(state, { textOpen: false, text: '' }), { text: undefined });
    if (input === 'enter') {
      const committed = state.text;
      if (!committed.trim()) return withState(state, { textOpen: false, text: '' });
      return advance(withQuestion(state, { text: committed }));
    }
    if (input === 'backspace') return withState(state, { text: [...state.text].slice(0, -1).join('') });
    if (input === 'space') return withState(state, { text: `${state.text} ` });
    if (typeof input === 'object' && 'char' in input) return withState(state, { text: state.text + input.char });
    return state;
  }
  switch (input) {
    case 'up':
      return moveCursor(state, -1);
    case 'down':
      return moveCursor(state, 1);
    case 'left': {
      if (state.index === 0) return state;
      return withState(state, { index: state.index - 1, textOpen: false, text: '' });
    }
    case 'right': {
      if (state.index >= state.questions.length - 1) return state;
      return withState(state, { index: state.index + 1, textOpen: false, text: '' });
    }
    case 'space':
      return toggleSelection(state);
    case 'enter': {
      const question = state.questions[state.index];
      const cursor = state.cursors[state.index];
      if (question && cursor === question.options.length) return withState(state, { textOpen: true, text: '' });
      return advance(state);
    }
    case 'escape':
      return withState(state, { finished: true });
    default: {
      if (typeof input === 'object' && input.char === ' ') return toggleSelection(state);
      return state;
    }
  }
}

export function panelAnswers(state: PanelState): readonly PanelAnswer[] {
  return state.questions.map((question, index) => {
    const optionIds = (state.selected[index] ?? []).map((optionIndex) => question.options[optionIndex]?.id).filter((id): id is string => id !== undefined);
    const text = state.texts[index];
    const answers = text !== undefined ? [text] : optionIds;
    return answers.length > 0 ? { id: question.id, answers, cancelled: false } : blank(question);
  });
}

export function panelResult(state: PanelState): PanelResult {
  return { state, answers: panelAnswers(state) };
}

const padInner = (text: string, innerWidth: number): string => `${text}${' '.repeat(Math.max(0, innerWidth - text.length))}`;
const row = (text: string, innerWidth: number): string => ` │ ${padInner(text, innerWidth)} │`;
const wrap = (text: string, width: number): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
};

export function renderPanel(state: PanelState, width: number): string[] {
  const boxWidth = Math.max(20, width - 2);
  const innerWidth = boxWidth - 4;
  const textWidth = innerWidth;
  const question = state.questions[state.index];
  if (!question) return [];
  const lines: string[] = [];
  lines.push(` ┌${'─'.repeat(boxWidth - 2)}┐`);
  lines.push(row(state.title, innerWidth));
  lines.push(row('', innerWidth));
  lines.push(row(`Question ${state.index + 1} of ${state.questions.length}`, innerWidth));
  lines.push(row('', innerWidth));
  for (const line of wrap(`${state.index + 1}. ${question.prompt}`, textWidth)) lines.push(row(line, innerWidth));
  lines.push(row('', innerWidth));
  question.options.forEach((option, optionIndex) => {
    const mark = (state.selected[state.index] ?? []).includes(optionIndex) ? 'x' : ' ';
    const content = optionIndex === state.cursors[state.index] ? `  › [${mark}] ${option.label}` : `    [${mark}] ${option.label}`;
    lines.push(row(content, innerWidth));
  });
  const committed = state.texts[state.index];
  const otherLabel = state.textOpen ? `Other: ${state.text}▏` : `Other: (type to answer)`;
  const otherMark = committed !== undefined ? 'x' : ' ';
  const otherContent = state.textOpen || state.cursors[state.index] === question.options.length ? `  › [${otherMark}] ${otherLabel}` : `    [${otherMark}] ${otherLabel}`;
  lines.push(row(otherContent, innerWidth));
  lines.push(row('', innerWidth));
  lines.push(row('↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip', innerWidth));
  lines.push(` └${'─'.repeat(boxWidth - 2)}┘`);
  return lines;
}

export function toPanelInput(data: string): PanelInput | undefined {
  if (matchesKey(data, 'up')) return 'up';
  if (matchesKey(data, 'down')) return 'down';
  if (matchesKey(data, 'left')) return 'left';
  if (matchesKey(data, 'right')) return 'right';
  if (matchesKey(data, 'escape')) return 'escape';
  if (matchesKey(data, 'enter')) return 'enter';
  if (matchesKey(data, 'backspace')) return 'backspace';
  if (data === ' ') return 'space';
  if (data.length === 1 && data.charCodeAt(0) >= 32) return { char: data };
  return undefined;
}