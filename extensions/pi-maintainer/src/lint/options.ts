import { booleanOption, listOption, stringOption } from '../settings/spec.ts';

/** The lint SAR's options from `aider/args.py`, with Aider's defaults and help text. */
export const lintOptions = {
  lint: booleanOption({
    name: 'lint',
    defaultValue: false,
    negatable: false,
    help: 'Lint and fix provided files, or dirty files if none provided',
    sar: 'lint',
  }),
  lintCmd: listOption({
    name: 'lint-cmd',
    help: 'Specify lint commands to run for different languages, eg: "python: flake8 --select=..." (can be used multiple times)',
    sar: 'lint',
  }),
  autoLint: booleanOption({
    name: 'auto-lint',
    defaultValue: true,
    negatable: true,
    help: 'Enable/disable automatic linting after changes (default: True)',
    sar: 'lint',
  }),
  testCmd: stringOption({
    name: 'test-cmd',
    defaultValue: null,
    help: 'Specify command to run tests',
    sar: 'lint',
  }),
  autoTest: booleanOption({
    name: 'auto-test',
    defaultValue: false,
    negatable: true,
    help: 'Enable/disable automatic testing after changes (default: False)',
    sar: 'lint',
  }),
  test: booleanOption({
    name: 'test',
    defaultValue: false,
    negatable: false,
    help: 'Run tests, fix problems found and then exit',
    sar: 'lint',
  }),
} as const;

export const lintOptionList = Object.values(lintOptions);
