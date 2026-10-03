/**
 * The post-edit repair pipeline as a pure decision over ports. Given the
 * per-message state and the turn's edited files it returns the entries to
 * append to the conversation and the reflection text to send as the next
 * user turn. The cap check happens after the user accepts a repair, so the
 * fourth failure text has already been shown when it is dropped.
 */

import { COMMAND_OUTPUT_CUSTOM_TYPE, FIX_LINT_QUESTION, FIX_TEST_QUESTION, REFLECTION_CUSTOM_TYPE, reflectionCapWarning } from './strings.ts';
import { type CustomMessageDraft, MAX_REFLECTIONS, type MessageRepairState } from './types.ts';

export interface PostEditConfig {
  readonly autoLint: boolean;
  readonly autoTest: boolean;
  readonly testCmd: string | undefined;
  readonly maxReflections: number;
  /** True when an edit or write tool call in this turn returned an error. */
  readonly editFailed: boolean;
}

export interface TestRunResult {
  readonly failed: boolean;
  /** The formatted run_output message, present when the output was added. */
  readonly formattedMessage: string | undefined;
}

export interface PostEditIo {
  readonly lintEdited: (paths: readonly string[]) => Promise<string | undefined>;
  readonly runTest: (cmd: string) => Promise<TestRunResult>;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly warning: (message: string) => void;
}

export interface PostEditPlan {
  readonly entries: readonly CustomMessageDraft[];
  readonly reflection: string | undefined;
  readonly lintOutcome: boolean | undefined;
  readonly testOutcome: boolean | undefined;
}

const EMPTY_PLAN: PostEditPlan = { entries: [], reflection: undefined, lintOutcome: undefined, testOutcome: undefined };

export async function planPostEditRepair(state: MessageRepairState, config: PostEditConfig, edited: readonly string[], io: PostEditIo): Promise<PostEditPlan> {
  if (edited.length === 0 || config.editFailed) return EMPTY_PLAN;

  let lintOutcome: boolean | undefined;
  if (config.autoLint) {
    const lintErrors = await io.lintEdited(edited);
    lintOutcome = lintErrors === undefined;
    if (lintErrors !== undefined) {
      const accepted = await io.confirm(FIX_LINT_QUESTION);
      if (accepted) return reflectFailure(state, config, io, lintErrors, [], lintOutcome);
    }
  }

  const testPlan = await testStep(state, config, io, lintOutcome);
  if (testPlan !== undefined) return testPlan;

  return {
    entries: [],
    reflection: undefined,
    lintOutcome,
    testOutcome: config.autoTest ? true : undefined,
  };
}

async function testStep(state: MessageRepairState, config: PostEditConfig, io: PostEditIo, lintOutcome: boolean | undefined): Promise<PostEditPlan | undefined> {
  if (!config.autoTest) return undefined;
  if (config.testCmd === undefined || config.testCmd === '') {
    return { ...EMPTY_PLAN, testOutcome: true, lintOutcome };
  }
  const result = await io.runTest(config.testCmd);
  const testOutcome = !result.failed;
  if (!result.failed || result.formattedMessage === undefined) {
    return { ...EMPTY_PLAN, testOutcome, lintOutcome };
  }

  const outputEntry: CustomMessageDraft = {
    customType: COMMAND_OUTPUT_CUSTOM_TYPE,
    content: result.formattedMessage,
    display: true,
  };
  const accepted = await io.confirm(FIX_TEST_QUESTION);
  if (!accepted) {
    return { entries: [outputEntry], reflection: undefined, lintOutcome, testOutcome };
  }
  return reflectFailure(state, config, io, result.formattedMessage, [outputEntry], testOutcome, lintOutcome);
}

function reflectFailure(state: MessageRepairState, config: PostEditConfig, io: PostEditIo, failureText: string, entries: readonly CustomMessageDraft[], testOutcome?: boolean, lintOutcome?: boolean): PostEditPlan {
  const base: PostEditPlan = { entries, reflection: undefined, lintOutcome, testOutcome };
  if (state.numReflections >= config.maxReflections) {
    io.warning(reflectionCapWarning(config.maxReflections));
    return base;
  }
  const reflection: CustomMessageDraft = {
    customType: REFLECTION_CUSTOM_TYPE,
    content: failureText,
    display: true,
  };
  return { ...base, entries: [...entries, reflection], reflection: failureText };
}

export function nextReflectionCount(state: MessageRepairState, plan: PostEditPlan): number {
  return plan.reflection === undefined ? state.numReflections : state.numReflections + 1;
}

export { MAX_REFLECTIONS };
