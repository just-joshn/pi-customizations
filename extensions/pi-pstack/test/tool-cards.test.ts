import { expect, test } from 'vitest';
import type { Theme } from '@earendil-works/pi-coding-agent';
import { askQuestionResultCard, setupWriteCard } from '../src/tool-cards.ts';

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;

const budgetQuestion = {
  id: 'budget',
  prompt: 'Which reasoning budget should pstack roles use?',
  options: [
    { id: 'unlimited', label: 'unlimited — max reasoning' },
    { id: 'large', label: 'large — xhigh reasoning' },
    { id: 'small', label: 'small — medium reasoning (current)' },
  ],
  allowMultiple: false,
};

const stripAnsi = (line: string) => line.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '').replace(/\u001B\]8;;[^\u0007]*\u0007/g, '');
const trimmed = (component: { render: (width: number) => string[] }, width = 120) =>
  component.render(width).map((line) => stripAnsi(line).trimEnd());

test('the submitted card shows the header, prompts, and the checked answer', () => {
  const args = { questions: [budgetQuestion] };
  const answers = [{ id: 'budget', answers: ['unlimited — max reasoning'], cancelled: false }];
  expect(trimmed(askQuestionResultCard(args, answers, theme))).toEqual([
    'AskQuestion Clarifying Questions (1)',
    '1. Which reasoning budget should pstack roles use?',
    '  [x] unlimited — max reasoning',
    '  [ ] large — xhigh reasoning',
    '  [ ] small — medium reasoning (current)',
  ]);
});

test('the all-skipped card right-aligns the skipped label like the reference', () => {
  const rolesQuestion = {
    id: 'roles',
    prompt: 'Keep every role on `inherit-parent`?',
    options: [
      { id: 'keep', label: 'Keep all on inherit-parent (Recommended)' },
      { id: 'change', label: 'Change specific roles' },
    ],
    allowMultiple: false,
  };
  const args = { title: 'pstack model configuration', questions: [budgetQuestion, rolesQuestion] };
  const answers = [
    { id: 'budget', answers: [], cancelled: true },
    { id: 'roles', answers: [], cancelled: true },
  ];
  const lines = trimmed(askQuestionResultCard(args, answers, theme));
  const header = lines[0] ?? '';
  expect(header.startsWith('AskQuestion pstack model configuration (2)')).toBe(true);
  expect(header.endsWith('Questions skipped by user')).toBe(true);
  expect(lines[1]).toBe('1. Which reasoning budget should pstack roles use?');
  expect(lines[2]).toBe('  [ ] unlimited — max reasoning');
  expect(lines[5]).toBe('');
  expect(lines[6]).toBe('2. Keep every role on `inherit-parent`?');
  expect(lines[8]).toBe('  [ ] Change specific roles');
});

test('a mixed card marks answered options and leaves skipped ones unchecked', () => {
  const rolesQuestion = {
    id: 'roles',
    prompt: 'Keep every role on `inherit-parent`?',
    options: [{ id: 'keep', label: 'Keep all on inherit-parent (Recommended)' }],
    allowMultiple: false,
  };
  const args = { questions: [budgetQuestion, rolesQuestion] };
  const answers = [
    { id: 'budget', answers: ['small — medium reasoning (current)'], cancelled: false },
    { id: 'roles', answers: [], cancelled: true },
  ];
  const lines = trimmed(askQuestionResultCard(args, answers, theme));
  expect(lines[0]).toBe('AskQuestion Clarifying Questions (2)');
  expect(lines[4]).toBe('  [x] small — medium reasoning (current)');
  expect(lines[2]).toBe('  [ ] unlimited — max reasoning');
  expect(lines[5]).toBe('');
  expect(lines[6]).toBe('2. Keep every role on `inherit-parent`?');
  expect(lines[7]).toBe('  [ ] Keep all on inherit-parent (Recommended)');
});

test('an Other answer renders as a checked Other row with the typed value', () => {
  const args = { questions: [{ ...budgetQuestion, options: [] }] };
  const answers = [{ id: 'budget', answers: ['medium — high reasoning'], cancelled: false }];
  expect(trimmed(askQuestionResultCard(args, answers, theme))[2]).toBe('  [x] Other: medium — high reasoning');
});

test('the write card reports the edited rule basename and line stats', () => {
  const before = ['# budget: small (medium)', 'feature, refactoring: inherit-parent', 'bug-fix: inherit-parent'].join('\n');
  const after = before.replace('small (medium)', 'unlimited (max)');
  const written = { written: true, rulePath: '/tmp/pi-ref-agent/pstack/models.mdc', budget: 'unlimited (max)', added: 1, removed: 1, before, after, roles: {}, dropped: [] };
  const lines = trimmed(setupWriteCard(written, theme));
  expect(lines[0]).toBe('Edited pstack-models.mdc +1 -1');
  expect(lines).toContain('▎- # budget: small (medium)');
  expect(lines).toContain('▎+ # budget: unlimited (max)');
  expect(lines).toContain('▎  feature, refactoring: inherit-parent');
});

test('an unchanged write card omits the diff body', () => {
  const text = '# budget: unlimited (max)\nfeature, refactoring: inherit-parent\n';
  const written = { added: 0, removed: 0, before: text, after: text };
  expect(trimmed(setupWriteCard(written, theme))).toEqual(['Edited pstack-models.mdc +0 -0']);
});