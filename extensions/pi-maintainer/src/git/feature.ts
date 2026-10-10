import type { Feature, GitPolicy } from '../feature.ts';
import type { ResolvedSettings } from '../settings/spec.ts';
import { gitOptionList, gitOptions } from './options.ts';
import { createGitPolicy, type GitPolicySettings } from './policy.ts';

function settingsFromEnv(settings: ResolvedSettings): GitPolicySettings {
  return {
    autoCommits: settings.value(gitOptions.autoCommits),
    dirtyCommits: settings.value(gitOptions.dirtyCommits),
    gitCommitVerify: settings.value(gitOptions.gitCommitVerify),
    attributeAuthor: settings.value(gitOptions.attributeAuthor),
    attributeCommitter: settings.value(gitOptions.attributeCommitter),
    attributeCommitMessageAuthor: settings.value(gitOptions.attributeCommitMessageAuthor),
    attributeCommitMessageCommitter: settings.value(gitOptions.attributeCommitMessageCommitter),
    attributeCoAuthoredBy: settings.value(gitOptions.attributeCoAuthoredBy),
    commitPrompt: settings.value(gitOptions.commitPrompt),
    aiderIgnore: settings.value(gitOptions.aiderIgnore),
    subtreeOnly: settings.value(gitOptions.subtreeOnly),
    commitLanguage: settings.value(gitOptions.commitLanguage),
  };
}

/** The git SAR: `GitPolicy` over Host.exec-backed git, with Aider's commit options. */
export const gitFeature: Feature<GitPolicy> & { readonly name: 'git' } = {
  name: 'git',
  options: gitOptionList,
  commands: [],
  create({ settings, host, cwd, gitRoot }) {
    return createGitPolicy({
      host,
      cwd,
      settings: settingsFromEnv(settings),
      ...(gitRoot !== undefined ? { repoRoot: gitRoot } : {}),
    });
  },
};

export { effectiveDirtyCommits, gitOptions, gitOptionList } from './options.ts';
export { createGitPolicy, resolveAiderIgnorePath } from './policy.ts';
