/**
 * The /run and /test command semantics: run a shell command, decide whether
 * the output joins the conversation, format the run_output message, and set
 * the input placeholder on a failing plain run. Only the exit status decides
 * failure.
 */

import { addedOutputMessage, addOutputQuestion, formatRunOutput, RUN_PLACEHOLDER } from './strings.ts';

export interface CommandRunResult {
  readonly exitStatus: number;
  readonly output: string;
  /** Present when the run_output message was added to the conversation. */
  readonly formattedMessage: string | undefined;
  /** The formatted message returned to the caller, only for failing tests. */
  readonly returnedMessage: string | undefined;
  readonly placeholder: boolean;
}

export interface CmdRunIo {
  readonly output: (message: string) => void;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly runShell: (command: string) => Promise<readonly [number, string]>;
}

/** Rough token estimate used for the add-output dialog; pi has no public tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countLines(output: string): number {
  const trimmed = output.trim();
  if (trimmed === '') return 0;
  return trimmed.split('\n').length;
}

export async function cmdRun(io: CmdRunIo, command: string, addOnNonzeroExit: boolean): Promise<CommandRunResult> {
  const [exitStatus, combinedOutput] = await io.runShell(command);

  const kTokens = (estimateTokens(combinedOutput) / 1000).toFixed(1);
  const add = addOnNonzeroExit ? exitStatus !== 0 : await io.confirm(addOutputQuestion(kTokens));

  if (!add) {
    return { exitStatus, output: combinedOutput, formattedMessage: undefined, returnedMessage: undefined, placeholder: false };
  }

  io.output(addedOutputMessage(countLines(combinedOutput)));
  const formattedMessage = formatRunOutput(command, combinedOutput);

  if (addOnNonzeroExit && exitStatus !== 0) {
    return { exitStatus, output: combinedOutput, formattedMessage, returnedMessage: formattedMessage, placeholder: false };
  }
  const placeholder = add && exitStatus !== 0;
  return {
    exitStatus,
    output: combinedOutput,
    formattedMessage,
    returnedMessage: undefined,
    placeholder,
  };
}

export { RUN_PLACEHOLDER };
