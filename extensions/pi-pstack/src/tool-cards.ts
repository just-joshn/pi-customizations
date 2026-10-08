// Compact human-readable tool cards for the transcript. The reference host collapses
// tool rows to titled cards and never dumps raw JSON; the card builders reproduce the
// captured reference forms byte-for-byte (see test/tool-cards.test.ts and
// parity/evidence/setup-prepair, parity/evidence/setup-cancel).
import { Container, HStack, Text } from '@earendil-works/pi-tui';

import { type PanelAnswer, defaultPanelTitle } from './questions-panel.ts';

type Titled = { fg(color: string, text: string): string; bold(text: string): string };

const titled = (text: string, theme: Titled): string => theme.fg('toolTitle', theme.bold(text));

export interface AskQuestionCallArgs {
  readonly title?: string | undefined;
  readonly questions: ReadonlyArray<{ readonly prompt: string; readonly options?: ReadonlyArray<{ readonly label: string }> }>;
}

export function askQuestionResultCard(args: AskQuestionCallArgs, answers: readonly PanelAnswer[], theme: Titled): Container {
  const component = new Container();
  const header = titled(`AskQuestion ${args.title ?? defaultPanelTitle} (${args.questions.length})`, theme);
  if (answers.length > 0 && answers.every((answer) => answer.cancelled)) {
    component.addChild(new HStack([{ component: new Text(header, 0, 0), grow: 1 }, new Text('Questions skipped by user', 0, 0)]));
  } else {
    component.addChild(new Text(header, 0, 0));
  }
  const [, ...rest] = questionLines(args, answers);
  if (rest.length > 0) component.addChild(new Text(rest.join('\n'), 0, 0));
  return component;
}

function questionLines(args: AskQuestionCallArgs, answers: readonly PanelAnswer[]): string[] {
  const lines: string[] = [titled(`AskQuestion ${args.title ?? defaultPanelTitle} (${args.questions.length})`, { fg: (_color, text) => text, bold: (text) => text })];
  args.questions.forEach((question, index) => {
    if (index > 0) lines.push('');
    lines.push(`${index + 1}. ${question.prompt}`);
    const options = question.options ?? [];
    const selected = answers[index]?.answers ?? [];
    for (const option of options) {
      lines.push(`  [${selected.includes(option.label) ? 'x' : ' '}] ${option.label}`);
    }
    const other = selected.filter((value) => !options.some((option) => option.label === value));
    for (const value of other) lines.push(`  [x] Other: ${value}`);
  });
  return lines;
}

export interface SetupState {
  readonly rulePath: string;
  readonly budget: string | null;
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly availableModels: readonly string[];
}

export interface SetupState {
  readonly rulePath: string;
  readonly budget: string | null;
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly availableModels: readonly string[];
}

export function setupWriteCard(written: { readonly rulePath: string; readonly budget: string | null }, _theme: Titled): Text {
  return new Text(`Wrote ${written.rulePath} with budget ${written.budget}.`, 0, 0);
}