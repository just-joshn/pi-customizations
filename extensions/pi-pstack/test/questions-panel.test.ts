import { expect, test } from 'vitest';

import { initialPanelState, panelAnswers, reducePanel, renderPanel, toPanelInput } from '../src/questions-panel.ts';
import type { PanelQuestion } from '../src/questions-panel.ts';

const budget: PanelQuestion = {
  id: 'budget',
  prompt: 'Pick a pstack budget. Current rule: small (medium), every role set to inherit-parent (which a re-run keeps).',
  options: [
    { id: 'unlimited', label: 'unlimited — max reasoning' },
    { id: 'large', label: 'large — xhigh reasoning' },
    { id: 'medium', label: 'medium — high reasoning' },
    { id: 'small', label: 'small — medium reasoning (current)' },
  ],
  allowMultiple: false,
};
const roles: PanelQuestion = {
  id: 'roles',
  prompt: 'All roles currently run on the parent chat model (inherit-parent). Accept as-is, or change specific roles?',
  options: [
    { id: 'accept', label: 'Accept as-is (Recommended) — all roles stay on the parent chat model' },
    { id: 'one-model', label: "Point all roles at one detected model (I'll ask which)" },
  ],
  allowMultiple: false,
};
const twoQuestions = [budget, roles];

test('initialPanelState defaults the title to Clarifying Questions', () => {
  expect(initialPanelState(twoQuestions).title).toBe('Clarifying Questions');
});

test('renders a model-provided title in place of the default header', () => {
  const lines = renderPanel(initialPanelState(twoQuestions, 'pstack model configuration'), 120);
  expect(lines[1]).toBe(` │ pstack model configuration${' '.repeat(114 - 'pstack model configuration'.length)} │`);
  expect(lines[0]).toBe(` ┌${'─'.repeat(116)}┐`);
});

test('renders the captured Clarifying Questions chrome at 120 columns', () => {
  const lines = renderPanel(initialPanelState(twoQuestions), 120);
  expect(lines[0]).toBe(` ┌${'─'.repeat(116)}┐`);
  expect(lines[1]).toBe(` │ Clarifying Questions${' '.repeat(114 - 'Clarifying Questions'.length)} │`);
  expect(lines[3]).toBe(` │ Question 1 of 2${' '.repeat(114 - 'Question 1 of 2'.length)} │`);
  expect(lines[7]).toBe(` │   › [ ] unlimited — max reasoning${' '.repeat(114 - '  › [ ] unlimited — max reasoning'.length)} │`);
  expect(lines[8]).toContain('│     [ ] large — xhigh reasoning');
  expect(lines[11]).toContain('│     [ ] Other: (type to answer)');
  expect(lines[13]).toBe(
    ` │ ↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip${' '.repeat(114 - '↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip'.length)} │`,
  );
  expect(lines[14]).toBe(` └${'─'.repeat(116)}┘`);
  expect(lines).toHaveLength(15);
});

test('renders the second question after advancing and keeps per-question cursors', () => {
  const advanced = reducePanel(reducePanel(initialPanelState(twoQuestions), { char: ' ' }), 'enter');
  const lines = renderPanel(advanced, 120);
  expect(lines[3]).toContain('Question 2 of 2');
  expect(lines[5]).toContain('2. All roles currently run on the parent chat model');
  expect(lines[7]).toContain('› [ ] Accept as-is (Recommended)');
});

test('space toggles the checkbox and toggling again clears it', () => {
  const checked = reducePanel(initialPanelState(twoQuestions), { char: ' ' });
  expect(renderPanel(checked, 120)[7]).toContain('› [x] unlimited — max reasoning');
  const unchecked = reducePanel(checked, { char: ' ' });
  expect(renderPanel(unchecked, 120)[7]).toContain('› [ ] unlimited — max reasoning');
});

test('down and up move the cursor and clamp at the ends', () => {
  const down = reducePanel(initialPanelState(twoQuestions), 'down');
  expect(renderPanel(down, 120)[7]).toContain('    [ ] unlimited — max reasoning');
  expect(renderPanel(down, 120)[8]).toContain('› [ ] large — xhigh reasoning');
  const clampedTop = reducePanel(reducePanel(initialPanelState(twoQuestions), 'up'), 'up');
  expect(renderPanel(clampedTop, 120)[7]).toContain('› [ ] unlimited');
  const bottom = reducePanel(reducePanel(reducePanel(reducePanel(initialPanelState(twoQuestions), 'down'), 'down'), 'down'), 'down');
  expect(renderPanel(bottom, 120)[11]).toContain('› [ ] Other: (type to answer)');
});

test('enter on the last question submits answered questions in order', () => {
  const selected = reducePanel(initialPanelState(twoQuestions), { char: ' ' });
  const submitted = reducePanel(reducePanel(selected, 'enter'), 'enter');
  expect(submitted.finished).toBe(true);
  expect(panelAnswers(submitted)).toEqual([
    { id: 'budget', answers: ['unlimited'], cancelled: false },
    { id: 'roles', answers: [], cancelled: true },
  ]);
});

test('left and right navigate between questions without losing selections', () => {
  const selected = reducePanel(initialPanelState(twoQuestions), { char: ' ' });
  const second = reducePanel(selected, 'enter');
  const back = reducePanel(second, 'left');
  expect(renderPanel(back, 120)[7]).toContain('› [x] unlimited');
  const forward = reducePanel(back, 'right');
  expect(renderPanel(forward, 120)[3]).toContain('Question 2 of 2');
});

test('escape submits answered questions and skips the rest', () => {
  const answered = reducePanel(initialPanelState(twoQuestions), { char: ' ' });
  const escaped = reducePanel(answered, 'escape');
  expect(escaped.finished).toBe(true);
  expect(panelAnswers(escaped)).toEqual([
    { id: 'budget', answers: ['unlimited'], cancelled: false },
    { id: 'roles', answers: [], cancelled: true },
  ]);
});

test('enter on the Other row opens text entry, typing commits a text answer', () => {
  const onOther = reducePanel(reducePanel(reducePanel(reducePanel(reducePanel(initialPanelState([budget]), 'down'), 'down'), 'down'), 'down'), 'enter');
  expect(renderPanel(onOther, 120)[11]).toContain('Other:');
  const typed = reducePanel(reducePanel(onOther, { char: 'h' }), { char: 'i' });
  expect(renderPanel(typed, 120)[11]).toContain('Other: hi');
  const committed = reducePanel(typed, 'enter');
  expect(committed.finished).toBe(true);
  expect(panelAnswers(committed)).toEqual([{ id: 'budget', answers: ['hi'], cancelled: false }]);
});

test('escape closes the open text entry without committing', () => {
  const onOther = reducePanel(reducePanel(reducePanel(reducePanel(reducePanel(initialPanelState([budget]), 'down'), 'down'), 'down'), 'down'), 'enter');
  const typed = reducePanel(onOther, { char: 'h' });
  const closed = reducePanel(typed, 'escape');
  expect(closed.finished).toBe(false);
  expect(panelAnswers(closed)[0]?.cancelled ?? true).toBe(true);
});

test('space appends a literal space in the open text entry', () => {
  const onOther = reducePanel(reducePanel(reducePanel(reducePanel(reducePanel(initialPanelState([budget]), 'down'), 'down'), 'down'), 'down'), 'enter');
  const typed = reducePanel(reducePanel(reducePanel(onOther, { char: 'a' }), 'space'), { char: 'b' });
  expect(renderPanel(typed, 120)[11]).toContain('Other: a b▏');
  const committed = reducePanel(typed, 'enter');
  expect(panelAnswers(committed)).toEqual([{ id: 'budget', answers: ['a b'], cancelled: false }]);
});

test('backspace edits the open text entry', () => {
  const onOther = reducePanel(reducePanel(reducePanel(reducePanel(reducePanel(initialPanelState([budget]), 'down'), 'down'), 'down'), 'down'), 'enter');
  const typed = reducePanel(reducePanel(onOther, { char: 'a' }), { char: 'b' });
  const cut = reducePanel(typed, 'backspace');
  expect(renderPanel(cut, 120)[11]).toContain('Other: a');
});

test('multiple selections answer with every selected id in option order', () => {
  const multi: PanelQuestion = { ...budget, allowMultiple: true };
  const picked = reducePanel(reducePanel(reducePanel(initialPanelState([multi]), { char: ' ' }), 'down'), { char: ' ' });
  const submitted = reducePanel(picked, 'enter');
  expect(panelAnswers(submitted)).toEqual([{ id: 'budget', answers: ['unlimited', 'large'], cancelled: false }]);
});
test('toPanelInput maps keys and printable characters', () => {
  expect(toPanelInput('\x1b[A')).toBe('up');
  expect(toPanelInput('\x1b[B')).toBe('down');
  expect(toPanelInput('\x1b[D')).toBe('left');
  expect(toPanelInput('\x1b[C')).toBe('right');
  expect(toPanelInput('\x1b')).toBe('escape');
  expect(toPanelInput(' ')).toBe('space');
  expect(toPanelInput('a')).toEqual({ char: 'a' });
  expect(toPanelInput('\x1b[1;5A')).toBeUndefined();
});
