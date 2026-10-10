import { booleanOption, stringOption, tristateOption } from '../settings/spec.ts';

/** The git SAR's options from `aider/args.py`, with Aider's defaults and help text. */
export const gitOptions = {
  git: booleanOption({
    name: 'git',
    defaultValue: true,
    negatable: true,
    help: 'Enable/disable looking for a git repo (default: True)',
    sar: 'git',
  }),
  gitignore: booleanOption({
    name: 'gitignore',
    defaultValue: true,
    negatable: true,
    help: 'Enable/disable adding .pi-maintainer* to .gitignore (default: True)',
    sar: 'git',
  }),
  autoCommits: booleanOption({
    name: 'auto-commits',
    defaultValue: true,
    negatable: true,
    help: 'Enable/disable auto commit of LLM changes (default: True)',
    sar: 'git',
  }),
  dirtyCommits: booleanOption({
    name: 'dirty-commits',
    defaultValue: true,
    negatable: true,
    help: 'Enable/disable commits when repo is found dirty (default: True)',
    sar: 'git',
  }),
  attributeAuthor: tristateOption({
    name: 'attribute-author',
    negatable: true,
    help: 'Attribute aider code changes in the git author name (default: True). If explicitly set to True, overrides --attribute-co-authored-by precedence.',
    sar: 'git',
  }),
  attributeCommitter: tristateOption({
    name: 'attribute-committer',
    negatable: true,
    help: 'Attribute aider commits in the git committer name (default: True). If explicitly set to True, overrides --attribute-co-authored-by precedence for aider edits.',
    sar: 'git',
  }),
  attributeCommitMessageAuthor: booleanOption({
    name: 'attribute-commit-message-author',
    defaultValue: false,
    negatable: true,
    help: "Prefix commit messages with 'aider: ' if aider authored the changes (default: False)",
    sar: 'git',
  }),
  attributeCommitMessageCommitter: booleanOption({
    name: 'attribute-commit-message-committer',
    defaultValue: false,
    negatable: true,
    help: "Prefix all commit messages with 'aider: ' (default: False)",
    sar: 'git',
  }),
  attributeCoAuthoredBy: booleanOption({
    name: 'attribute-co-authored-by',
    defaultValue: true,
    negatable: true,
    help: 'Attribute aider edits using the Co-authored-by trailer in the commit message (default: True). If True, this takes precedence over default --attribute-author and --attribute-committer behavior unless they are explicitly set to True.',
    sar: 'git',
  }),
  gitCommitVerify: booleanOption({
    name: 'git-commit-verify',
    defaultValue: false,
    negatable: true,
    help: 'Enable/disable git pre-commit hooks with --no-verify (default: False)',
    sar: 'git',
  }),
  commitPrompt: stringOption({
    name: 'commit-prompt',
    defaultValue: null,
    help: 'Specify a custom prompt for generating commit messages',
    sar: 'git',
  }),
  aiderIgnore: stringOption({
    name: 'aiderignore',
    defaultValue: null,
    help: 'Specify the aider ignore file (default: .aiderignore in git root)',
    sar: 'git',
  }),
  subtreeOnly: booleanOption({
    name: 'subtree-only',
    defaultValue: false,
    negatable: false,
    help: 'Only consider files in the current subtree of the git repository',
    sar: 'git',
  }),
  commitLanguage: stringOption({
    name: 'commit-language',
    defaultValue: null,
    help: 'Specify the language to use in the commit message (default: None, user language)',
    sar: 'git',
  }),
} as const;

export const gitOptionList = Object.values(gitOptions);

/** Aider forces dirty commits off when automatic commits are off (`base_coder.py:409-413`). */
export function effectiveDirtyCommits(autoCommits: boolean, dirtyCommits: boolean): boolean {
  return autoCommits ? dirtyCommits : false;
}
