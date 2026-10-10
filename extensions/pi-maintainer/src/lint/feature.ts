import type { Feature, Validation } from '../feature.ts';
import type { ResolvedSettings } from '../settings/spec.ts';
import { lintCommands } from './commands.ts';
import { lintOptionList, lintOptions } from './options.ts';
import { parseLintCmds } from './parse-lint-cmds.ts';
import { createValidation } from './validation.ts';

function settingsFromEnv(settings: ResolvedSettings) {
  return {
    autoLint: settings.value(lintOptions.autoLint),
    autoTest: settings.value(lintOptions.autoTest),
    lintCmds: parseLintCmds(settings.value(lintOptions.lintCmd)),
    testCmd: settings.value(lintOptions.testCmd),
  };
}

/** The lint SAR: `Validation` over Host.exec with Aider's lint and test options. */
export const lintFeature: Feature<Validation> & { readonly name: 'lint' } = {
  name: 'lint',
  options: lintOptionList,
  commands: lintCommands,
  create({ settings, host, cwd, gitRoot }) {
    const root = gitRoot ?? cwd;
    return createValidation({
      host,
      root,
      ...settingsFromEnv(settings),
    });
  },
};

export { lintCommands } from './commands.ts';
export { createValidation } from './validation.ts';
export { lintOptions, lintOptionList } from './options.ts';
export { parseLintCmds } from './parse-lint-cmds.ts';
export { findFilenamesAndLinenums, lintFile, resolveLintCommand } from './linter.ts';
export { selectLintRelativeFiles, listDirtyRelativeFiles } from './select-files.ts';
export { formatRunOutput } from './run-output.ts';
