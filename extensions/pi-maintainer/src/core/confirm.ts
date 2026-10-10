import { pyLength, splitlines } from '../support/pystr.ts';

type Preference = 'all' | 'skip';

/** `aider.io.ConfirmGroup`: a batch of related questions that can share one answer. */
export class ConfirmGroup {
  readonly showGroup: boolean;
  #preference: Preference | null = null;

  constructor(items?: Iterable<unknown>) {
    this.showGroup = items === undefined ? true : [...items].length > 1;
  }

  get preference(): Preference | null {
    return this.#preference;
  }

  prefer(preference: Preference): void {
    this.#preference = preference;
  }
}

/** The arguments of `InputOutput.confirm_ask`. */
export interface ConfirmRequest {
  readonly question: string;
  readonly defaultAnswer?: string;
  readonly subject?: string | null;
  readonly explicitYesRequired?: boolean;
  readonly group?: ConfirmGroup | null;
  readonly allowNever?: boolean;
}

export type ConfirmChoice = 'yes' | 'no' | 'all' | 'skip' | "don't";

/** What Aider shows before reading an answer: the full prompt line and the offered choices. */
export interface ConfirmPrompt {
  readonly question: string;
  readonly text: string;
  readonly subject: string | null;
  readonly offered: readonly ConfirmChoice[];
  readonly valid: readonly ConfirmChoice[];
  readonly defaultAnswer: string;
}

/** The parts of `InputOutput` that `confirm_ask` reads and writes. */
export interface ConfirmIO {
  /** `--yes-always` sets true; Aider's tests can also set false. */
  readonly yes: boolean | null;
  isNever(key: string): boolean;
  rememberNever(key: string): void;
  /** Reads one typed answer, or null where Aider's `input()` raises EOFError. */
  ask(prompt: ConfirmPrompt): Promise<string | null>;
  output(message: string): void;
  error(message: string): void;
}

const neverKey = (question: string, subject: string | null): string => JSON.stringify([question, subject]);

function offeredChoices(group: ConfirmGroup | null, explicitYesRequired: boolean, allowNever: boolean): ConfirmChoice[] {
  const offered: ConfirmChoice[] = ['yes', 'no'];
  if (group && !explicitYesRequired) offered.push('all');
  if (group) offered.push('skip');
  if (allowNever) offered.push("don't");
  return offered;
}

function optionsText(offered: readonly ConfirmChoice[]): string {
  const labels: Record<ConfirmChoice, string> = { yes: '(Y)es', no: '(N)o', all: '(A)ll', skip: '(S)kip all', "don't": "(D)on't ask again" };
  return ` ${offered.map((choice) => labels[choice]).join('/')}`;
}

function promptText(question: string, options: string, defaultAnswer: string): string {
  if (defaultAnswer.toLowerCase().startsWith('y')) return `${question}${options} [Yes]: `;
  if (defaultAnswer.toLowerCase().startsWith('n')) return `${question}${options} [No]: `;
  return `${question}${options} [${defaultAnswer}]: `;
}

function showSubject(subject: string | null, io: ConfirmIO): void {
  if (!subject) return;
  io.output('');
  if (!subject.includes('\n')) {
    io.output(subject);
    return;
  }
  const lines = splitlines(subject);
  const width = Math.max(...lines.map(pyLength));
  io.output(lines.map((line) => line + ' '.repeat(Math.max(0, width - pyLength(line)))).join('\n'));
}

async function readAnswer(prompt: ConfirmPrompt, io: ConfirmIO): Promise<string> {
  for (;;) {
    const typed = await io.ask(prompt);
    if (typed === null || typed === '') return prompt.defaultAnswer;
    const lowered = typed.toLowerCase();
    if (prompt.valid.some((choice) => choice.startsWith(lowered))) return lowered;
    io.error(`Please answer with one of: ${prompt.valid.join(', ')}`);
  }
}

async function chooseAnswer(prompt: ConfirmPrompt, group: ConfirmGroup | null, explicitYesRequired: boolean, io: ConfirmIO): Promise<string> {
  if (io.yes === true) return explicitYesRequired ? 'n' : 'y';
  if (io.yes === false) return 'n';
  if (group?.preference) {
    io.output(`${prompt.text}${group.preference}`);
    return group.preference;
  }
  return readAnswer(prompt, io);
}

/** `InputOutput.confirm_ask`, answering through `io`. */
export async function confirmAsk(request: ConfirmRequest, io: ConfirmIO): Promise<boolean> {
  const subject = request.subject ?? null;
  const explicitYesRequired = request.explicitYesRequired ?? false;
  const defaultAnswer = request.defaultAnswer ?? 'y';
  const key = neverKey(request.question, subject);
  if (io.isNever(key)) return false;
  const group = request.group?.showGroup ? request.group : null;
  const allowNever = group !== null || (request.allowNever ?? false);
  const offered = offeredChoices(group, explicitYesRequired, allowNever);
  const valid: ConfirmChoice[] = allowNever ? ['yes', 'no', 'skip', 'all', "don't"] : ['yes', 'no', 'skip', 'all'];
  const prompt: ConfirmPrompt = { question: request.question, text: promptText(request.question, optionsText(offered), defaultAnswer), subject, offered, valid, defaultAnswer };
  showSubject(subject, io);
  const res = (await chooseAnswer(prompt, group, explicitYesRequired, io)).toLowerCase()[0] ?? '';
  if (res === 'd' && allowNever) {
    io.rememberNever(key);
    return false;
  }
  const isYes = explicitYesRequired ? res === 'y' : res === 'y' || res === 'a';
  if (group && res === 'a' && !explicitYesRequired) group.prefer('all');
  else if (group && res === 's') group.prefer('skip');
  return isYes;
}
