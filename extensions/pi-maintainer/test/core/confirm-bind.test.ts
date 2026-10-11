import { expect, test } from 'vitest';
import { ConfirmGroup, type ConfirmIO, type ConfirmPrompt, confirmAsk } from '../../src/core/confirm.ts';

function scriptedIO(options: { readonly yes?: boolean | null; readonly typed?: Array<string | null>; readonly never?: Set<string> }): ConfirmIO & { readonly prompts: ConfirmPrompt[]; readonly errors: string[]; readonly outputs: string[] } {
  const typed = [...(options.typed ?? [])];
  const never = options.never ?? new Set<string>();
  const prompts: ConfirmPrompt[] = [];
  const errors: string[] = [];
  const outputs: string[] = [];
  return {
    yes: options.yes ?? null,
    prompts,
    errors,
    outputs,
    isNever: (key) => never.has(key),
    rememberNever: (key) => {
      never.add(key);
    },
    ask: async (prompt) => {
      prompts.push(prompt);
      return typed.shift() ?? null;
    },
    output: (message) => {
      outputs.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
  };
}

test('empty and EOF answers take the default yes while invalid input reprompts', {
  meta: {
    aider: ['test_io/TestInputOutput.test_confirm_ask_yes_no', 'test_main/TestMain.test_default_yes'],
  },
}, async () => {
  const empty = scriptedIO({ typed: [''] });
  expect(await confirmAsk({ question: 'Allow?' }, empty)).toBe(true);
  expect(empty.prompts[0]?.text).toContain('(Y)es/(N)o');
  expect(empty.prompts[0]?.text).toContain('[Yes]');

  const eof = scriptedIO({ typed: [null] });
  expect(await confirmAsk({ question: 'Allow?' }, eof)).toBe(true);

  const prefix = scriptedIO({ typed: ['Y'] });
  expect(await confirmAsk({ question: 'Allow?' }, prefix)).toBe(true);

  const invalid = scriptedIO({ typed: ['wat', 'no'] });
  expect(await confirmAsk({ question: 'Allow?', subject: 'path.txt' }, invalid)).toBe(false);
  expect(invalid.outputs).toEqual(['', 'path.txt']);
  expect(invalid.errors).toEqual(['Please answer with one of: yes, no, skip, all']);
  expect(invalid.prompts).toHaveLength(2);
});

test('yes-always answers yes except explicit-yes questions, and always-no answers no', {
  meta: {
    aider: ['test_io/TestInputOutput.test_confirm_ask_explicit_yes_required', 'test_main/TestMain.test_yes'],
  },
}, async () => {
  const yesAlways = scriptedIO({ yes: true, typed: ['no'] });
  expect(await confirmAsk({ question: 'Allow?' }, yesAlways)).toBe(true);
  expect(yesAlways.prompts).toHaveLength(0);

  const explicit = scriptedIO({ yes: true, typed: ['yes'] });
  expect(await confirmAsk({ question: 'Run?', explicitYesRequired: true }, explicit)).toBe(false);
  expect(explicit.prompts).toHaveLength(0);

  const alwaysNo = scriptedIO({ yes: false, typed: ['yes'] });
  expect(await confirmAsk({ question: 'Allow?' }, alwaysNo)).toBe(false);
  expect(alwaysNo.prompts).toHaveLength(0);

  const explicitTyped = scriptedIO({ typed: ['yes'] });
  expect(await confirmAsk({ question: 'Run?', explicitYesRequired: true, subject: 'a\nb' }, explicitTyped)).toBe(true);
  expect(explicitTyped.prompts[0]?.offered).toEqual(['yes', 'no']);
});

test('a multi-item confirm group shares All and Skip without asking again', {
  meta: {
    aider: ['test_io/TestInputOutput.test_confirm_ask_with_group'],
  },
}, async () => {
  const group = new ConfirmGroup(['a', 'b']);
  const all = scriptedIO({ typed: ['all'] });
  expect(await confirmAsk({ question: 'Allow?', subject: 'a', group }, all)).toBe(true);
  expect(all.prompts[0]?.offered).toEqual(['yes', 'no', 'all', 'skip', "don't"]);
  expect(group.preference).toBe('all');
  expect(await confirmAsk({ question: 'Allow?', subject: 'b', group }, all)).toBe(true);
  expect(all.prompts).toHaveLength(1);

  const skipGroup = new ConfirmGroup(['a', 'b']);
  const skip = scriptedIO({ typed: ['skip'] });
  expect(await confirmAsk({ question: 'Allow?', subject: 'a', group: skipGroup }, skip)).toBe(false);
  expect(skipGroup.preference).toBe('skip');
  expect(await confirmAsk({ question: 'Allow?', subject: 'b', group: skipGroup }, skip)).toBe(false);
  expect(skip.prompts).toHaveLength(1);

  const explicitGroup = new ConfirmGroup(['a', 'b']);
  explicitGroup.prefer('all');
  const explicit = scriptedIO({ typed: ['yes'] });
  expect(await confirmAsk({ question: 'Run?', explicitYesRequired: true, group: explicitGroup }, explicit)).toBe(false);
  expect(explicit.prompts).toHaveLength(0);
});

test("Don't ask again denies the same question and subject for the rest of the session", {
  meta: {
    aider: ['test_io/TestInputOutput.test_confirm_ask_allow_never'],
  },
}, async () => {
  const never = new Set<string>();
  const io = scriptedIO({ typed: ["don't", 'yes'], never });
  expect(await confirmAsk({ question: 'Allow?', subject: 'a', allowNever: true }, io)).toBe(false);
  expect(io.prompts[0]?.offered).toContain("don't");
  expect(await confirmAsk({ question: 'Allow?', subject: 'a' }, io)).toBe(false);
  expect(await confirmAsk({ question: 'Allow?', subject: 'b' }, io)).toBe(true);
  expect(never.has(JSON.stringify(['Allow?', 'a']))).toBe(true);
  expect(io.prompts).toHaveLength(2);
});
