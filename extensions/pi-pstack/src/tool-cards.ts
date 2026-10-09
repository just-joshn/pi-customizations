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

export interface SetupWriteCardInput {
  readonly added: number;
  readonly removed: number;
  readonly before: string;
  readonly after: string;
}

/** Reference host edit card: title plus ▎-gutter context around the first changed hunk. */
export function hostEditDiffLines(before: string, after: string, contextLines = 3): string[] {
  const previous = before.split(/\r?\n/);
  const next = after.split(/\r?\n/);
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let endPrev = previous.length - 1;
  let endNext = next.length - 1;
  while (endPrev >= start && endNext >= start && previous[endPrev] === next[endNext]) {
    endPrev -= 1;
    endNext -= 1;
  }
  if (start > endPrev && start > endNext) return [];
  const contextStart = Math.max(0, start - contextLines);
  const contextEndPrev = Math.min(previous.length - 1, endPrev + contextLines);
  const contextEndNext = Math.min(next.length - 1, endNext + contextLines);
  const lines: string[] = [];
  for (let index = contextStart; index < start; index += 1) lines.push(`▎  ${previous[index] ?? ''}`);
  for (let index = start; index <= endPrev; index += 1) lines.push(`▎- ${previous[index] ?? ''}`);
  for (let index = start; index <= endNext; index += 1) lines.push(`▎+ ${next[index] ?? ''}`);
  const trailingStart = endPrev + 1;
  const trailingCount = contextEndPrev - endPrev;
  for (let offset = 0; offset < trailingCount; offset += 1) {
    const index = trailingStart + offset;
    if (index > contextEndPrev) break;
    lines.push(`▎  ${previous[index] ?? ''}`);
  }
  if (trailingCount === 0) {
    for (let index = endNext + 1; index <= contextEndNext; index += 1) lines.push(`▎  ${next[index] ?? ''}`);
  }
  return lines;
}

export function setupWriteCard(written: SetupWriteCardInput, _theme: Titled): Container {
  // Reference host labels the rule pstack-models.mdc even when the Pi path is …/pstack/models.mdc.
  const component = new Container();
  component.addChild(new Text(`Edited pstack-models.mdc +${written.added} -${written.removed}`, 0, 0));
  const diff = hostEditDiffLines(written.before, written.after);
  if (diff.length > 0) component.addChild(new Text(`\n${diff.join('\n')}`, 0, 0));
  return component;
}
