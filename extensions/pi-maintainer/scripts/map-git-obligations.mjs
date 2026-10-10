#!/usr/bin/env node
// Build the git SAR obligation map: open ledger rows for uncovered behavioral
// clusters, and coverage.json entries for every git-slice census unit.
// Rerun: node scripts/map-git-obligations.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { census } from './census.mjs';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(join(packageRoot, path), 'utf8'));
const writeJson = (path, value) => writeFileSync(join(packageRoot, path), `${JSON.stringify(value, null, 2)}\n`);

const sources = readJson('parity/sources.json');
const testOwners = readJson('parity/test-owners.json');
const moduleOwners = sources.testModuleOwners ?? {};

function sliceOf(unitId) {
  const [group = '', module = ''] = unitId.split('/');
  if (group !== 'aider-test') return group.replace(/^ev-/, '');
  return Object.hasOwn(moduleOwners, module) ? moduleOwners[module] : testOwners[unitId];
}

const VERIFIED = new Set([
  'git.architect.return-editor-commits',
  'git.authorize.skip-gitignored',
  'git.authorize.stage-new-file',
  'git.dirty.checkpoint-before-edit',
  'git.dirty.off-without-auto-commits',
  'git.commit.stage-whole-files',
  'git.commit.message-context',
  'git.mentions.add-and-reflect',
  'git.commands.add-refuses-outside-root',
  'git.undo.preconditions',
  'git.undo.restore-and-reset',
  'git.inventory.tracked-files',
]);

/** @type {Array<{id: string, behavior: string, aider: string[]}>} */
const OPEN_ROWS = [
  {
    id: 'git.startup.discover-root',
    behavior: 'Startup discovers the Git root from the working directory before constructing the coder, and that root locates config, history, ignore, and env files.',
    aider: ['aider/main.py:60-85,460-504', 'aider/args.py:22-32,272-275,422-432'],
  },
  {
    id: 'git.startup.setup-repo',
    behavior: 'When no repository exists, setup_git offers initialization outside the home directory and make_new_repo creates a repo with ignore patterns without a second confirmation.',
    aider: ['aider/main.py:88-129'],
  },
  {
    id: 'git.startup.sanity-check',
    behavior: 'Repository sanity checks refuse bare repositories, corrupt repos, unsupported index versions above 2 when unsafe, and continue carefully on detached HEAD.',
    aider: ['aider/repo.py:62-129'],
  },
  {
    id: 'git.filter.gitignore',
    behavior: 'Git ignore rules via git check-ignore reject ignored paths for initial editable files, /add, and edit permission unless an explicit editing path bypasses the check.',
    aider: ['aider/repo.py:489-520', 'aider/commands.py:800-870'],
  },
  {
    id: 'git.filter.aiderignore',
    behavior: 'Aider ignore rules exclude matching tracked paths from inventory and from add/edit flows that consult the ignore file.',
    aider: ['aider/repo.py:433-520', 'aider/main.py:460-520'],
  },
  {
    id: 'git.filter.subtree',
    behavior: 'Subtree-only mode limits repository inventory and addable paths to the configured subdirectory tree.',
    aider: ['aider/repo.py:433-487'],
  },
  {
    id: 'git.inventory.addable-files',
    behavior: 'get_addable_relative_files returns filtered inventory minus editable and read-only chat files, sorted and deduplicated.',
    aider: ['aider/coders/base_coder.py:2153-2173'],
  },
  {
    id: 'git.inventory.no-repo-fallback',
    behavior: 'Without a repository, relative file inventory is limited to in-chat files rather than a Git-backed listing.',
    aider: ['aider/coders/base_coder.py:2153-2167'],
  },
  {
    id: 'git.dirty.path-semantics',
    behavior: 'GitRepo.is_dirty() without a path excludes untracked files by GitPython default, while is_dirty(path) is true for paths absent from filtered inventory.',
    aider: ['aider/repo.py:598-602'],
  },
  {
    id: 'git.commit.auto-after-edit',
    behavior: 'After applying edits, the base coder automatically commits edited files when automatic commits are on, before lint and test follow-ups.',
    aider: ['aider/coders/base_coder.py:2295-2424'],
  },
  {
    id: 'git.commit.noop-when-clean',
    behavior: 'commit returns early without a model call when there is no selected filename set and the repository is clean, or when the computed diff is empty.',
    aider: ['aider/repo.py:280-315'],
  },
  {
    id: 'git.commit.verify-flag',
    behavior: 'When git-commit-verify is off, commits pass --no-verify so pre-commit hooks do not block the assistant commit.',
    aider: ['aider/repo.py:280-318'],
  },
  {
    id: 'git.commit.attribution',
    behavior: 'Assistant commits apply CLI attribution defaults for Co-authored-by trailers and committer name suffixes according to attribution flags and aider_edits.',
    aider: ['aider/repo.py:199-280', 'aider/args.py:240-280'],
  },
  {
    id: 'git.commit.message-language',
    behavior: 'Commit-message generation respects the configured commit language when prompting the commit-message models.',
    aider: ['aider/repo.py:326-373', 'aider/args.py:400-450'],
  },
  {
    id: 'git.commit.selected-files-only',
    behavior: 'A selected-file commit stages and commits only the named edit files, leaving unrelated staged or dirty files untouched.',
    aider: ['aider/repo.py:280-315', 'aider/coders/base_coder.py:2375-2424'],
  },
  {
    id: 'git.diff.for-commit-message',
    behavior: 'Commit-message diffs compare filesystem content to HEAD for the selected paths and include staged and unstaged changes rather than a single staged patch.',
    aider: ['aider/repo.py:375-403'],
  },
  {
    id: 'git.diff.cmd-display',
    behavior: '/diff compares against HEAD^ when fewer than two message checkpoints exist, otherwise against the second-last checkpoint, and warns when the baseline equals HEAD or is empty.',
    aider: ['aider/commands.py:664-683'],
  },
  {
    id: 'git.diff.detached-and-unborn',
    behavior: 'Diff extraction handles detached HEAD and unborn-branch repositories without treating them as ordinary attached-branch HEAD comparisons.',
    aider: ['aider/repo.py:375-403'],
  },
  {
    id: 'git.commands.raw-git',
    behavior: '/git prepends git to the supplied text, runs it with shell=True, forces GIT_EDITOR=true, shows combined output without adding it to chat, and does not set cwd to the repo root.',
    aider: ['aider/commands.py:690-720'],
  },
  {
    id: 'git.commands.commit',
    behavior: '/commit triggers a repository commit of current changes using the shared commit path and optional user message.',
    aider: ['aider/commands.py:520-560'],
  },
  {
    id: 'git.commands.add-from-subdir',
    behavior: '/add from a subdirectory resolves paths relative to the repository and can add those files into the chat.',
    aider: ['aider/commands.py:800-900'],
  },
  {
    id: 'git.commands.add-ignore-policy',
    behavior: '/add refuses or warns on gitignored and aiderignored paths according to ignore policy rather than silently adding them.',
    aider: ['aider/commands.py:800-900'],
  },
  {
    id: 'git.commands.add-untracked',
    behavior: '/add and drop handle untracked files so they can enter or leave the chat without incorrectly treating them as tracked inventory.',
    aider: ['aider/commands.py:800-950'],
  },
  {
    id: 'git.config.auto-commits',
    behavior: 'The --git, --auto-commits, --dirty-commits, and related BooleanOptionalAction options form the effective Git policy after CLI, env, and YAML merge.',
    aider: ['aider/args.py:240-450', 'aider/main.py:460-520'],
  },
  {
    id: 'git.config.gitignore-offer',
    behavior: 'When --gitignore is on, startup can offer to append Aider and environment-file exclusions to .gitignore.',
    aider: ['aider/main.py:130-200', 'aider/args.py:240-300'],
  },
  {
    id: 'git.config.aiderignore-path',
    behavior: 'The aiderignore path resolves from configuration relative to the Git root and is used for inventory and add filters.',
    aider: ['aider/main.py:460-520', 'aider/args.py:272-320'],
  },
  {
    id: 'git.repo.open-single-root',
    behavior: 'GitRepo opens exactly one discovered repository root with GitDB and throws FileNotFoundError when zero or multiple roots match the inputs.',
    aider: ['aider/repo.py:62-129'],
  },
  {
    id: 'git.repo.unavailable',
    behavior: 'When GitPython is unavailable or the git executable is missing, Git integration disables repository arguments and continues without a repo rather than crashing the whole process.',
    aider: ['aider/repo.py:6-17', 'aider/main.py:512-513'],
  },
  {
    id: 'git.dry-run.skips-commits',
    behavior: 'Coder dry-run mode returns from auto_commit without writing commits, and CLI --commit also guards dry-run before committing.',
    aider: ['aider/coders/base_coder.py:2375-2377', 'aider/main.py:1065-1069'],
  },
  {
    id: 'git.security.path-trust',
    behavior: 'Working-tree path helpers resolve symlinks for some checks but do not enforce root containment on every path API, while /add outside-root refusal remains conditional on automatic commits for non-image files.',
    aider: ['aider/coders/base_coder.py:2100-2250', 'aider/commands.py:846-856'],
  },
  {
    id: 'git.hooks.pre-commit-boundary',
    behavior: 'Pre-commit hooks remain a Git trust boundary for commits that run verify, separate from aider dirty checkpoints and message generation.',
    aider: ['aider/repo.py:280-318'],
  },
  {
    id: 'git.worktree.linked-and-index',
    behavior: 'Linked worktrees and uncommon index versions are handled through the same GitRepo discovery and sanity paths rather than a separate VCS backend.',
    aider: ['aider/repo.py:62-129'],
  },
];

function rows(...ids) {
  return { rows: ids };
}

function nonclaim(category, note) {
  return { nonclaim: category, note };
}

// Section slug -> default mapping for every unit under git/<slug>/
const SECTION_RULES = {
  'aider-git-software-architecture-reconstruction': nonclaim('provenance', 'reconstruction title and date'),
  'what-this-reconstruction-establishes': rows(
    'git.inventory.tracked-files',
    'git.dirty.checkpoint-before-edit',
    'git.commit.auto-after-edit',
    'git.startup.discover-root',
  ),
  'baseline-and-identity': nonclaim('provenance', 'checkout path, commit, and distribution identity'),
  'installed-executable-and-local-verification-environment': nonclaim('evidence', 'local venv executable and verification interpreter'),
  'evidence-notation-and-navigation': nonclaim('meta', 'evidence notation and navigation conventions'),
  'the-state-model': rows(
    'git.inventory.tracked-files',
    'git.dirty.path-semantics',
    'git.dirty.checkpoint-before-edit',
    'git.commit.stage-whole-files',
    'git.undo.preconditions',
  ),
  'repository-membership-is-not-git-ls-files': rows('git.inventory.tracked-files', 'git.filter.aiderignore'),
  'dirty-state-has-two-meanings': rows('git.dirty.path-semantics', 'git.dirty.checkpoint-before-edit'),
  'three-kinds-of-commit': rows(
    'git.dirty.checkpoint-before-edit',
    'git.commit.auto-after-edit',
    'git.commit.stage-whole-files',
    'git.commit.attribution',
  ),
  'component-and-dependency-graph': rows(
    'git.startup.discover-root',
    'git.repo.open-single-root',
    'git.commit.auto-after-edit',
    'git.inventory.tracked-files',
  ),
  '1-startup-discovers-the-repository-before-constructing-the-c': rows(
    'git.startup.discover-root',
    'git.config.auto-commits',
    'git.config.aiderignore-path',
  ),
  '2-startup-can-mutate-repository-metadata': rows('git.startup.setup-repo', 'git.config.gitignore-offer'),
  'configuration-contract': rows(
    'git.config.auto-commits',
    'git.config.gitignore-offer',
    'git.config.aiderignore-path',
    'git.commit.attribution',
    'git.commands.raw-git',
  ),
  '3-file-filters-have-separate-jobs': rows(
    'git.filter.gitignore',
    'git.filter.aiderignore',
    'git.filter.subtree',
    'git.authorize.skip-gitignored',
  ),
  '4-repository-inventory-becomes-model-context': rows(
    'git.inventory.tracked-files',
    'git.inventory.addable-files',
    'git.inventory.no-repo-fallback',
  ),
  '5-edit-formats-share-commit-orchestration': rows(
    'git.dirty.checkpoint-before-edit',
    'git.commit.auto-after-edit',
    'git.authorize.stage-new-file',
    'git.architect.return-editor-commits',
  ),
  '6-dirty-checkpoints-precede-assistant-writes': rows(
    'git.dirty.checkpoint-before-edit',
    'git.dirty.off-without-auto-commits',
    'git.authorize.skip-gitignored',
  ),
  '7-automatic-commits-and-validation-are-separate': rows(
    'git.commit.auto-after-edit',
    'git.dirty.off-without-auto-commits',
    'git.commit.stage-whole-files',
  ),
  '8-commit-execution-selects-whole-files': rows(
    'git.commit.stage-whole-files',
    'git.commit.noop-when-clean',
    'git.commit.message-context',
    'git.commit.selected-files-only',
    'git.commit.verify-flag',
  ),
  '9-diffs-for-messages-are-not-always-a-single-patch': rows(
    'git.diff.for-commit-message',
    'git.diff.detached-and-unborn',
    'git.commit.message-context',
  ),
  '10-commit-messages-cross-the-model-boundary': rows(
    'git.commit.message-context',
    'git.commit.message-language',
  ),
  '11-attribution-has-cli-and-library-defaults': rows('git.commit.attribution'),
  '12-diff-display-has-two-execution-paths': rows('git.diff.cmd-display'),
  '13-undo-is-a-guarded-local-history-rewrite': rows('git.undo.preconditions', 'git.undo.restore-and-reset'),
  '14-manual-git-is-a-different-trust-boundary': rows('git.commands.raw-git', 'git.security.path-trust'),
  'source-registry-and-ownership': nonclaim('provenance', 'source path registry at the pinned commit'),
  'gitrepo-method-contracts': rows(
    'git.repo.open-single-root',
    'git.commit.stage-whole-files',
    'git.commit.message-context',
    'git.diff.for-commit-message',
    'git.inventory.tracked-files',
    'git.dirty.path-semantics',
    'git.filter.gitignore',
    'git.commit.attribution',
    'git.commit.verify-flag',
  ),
  'direct-and-transitive-dependency-responsibilities': rows(
    'git.repo.open-single-root',
    'git.inventory.tracked-files',
    'git.filter.gitignore',
    'git.commit.stage-whole-files',
    'git.diff.for-commit-message',
    'git.repo.unavailable',
  ),
  'operation-inventory': rows(
    'git.startup.discover-root',
    'git.startup.setup-repo',
    'git.inventory.tracked-files',
    'git.commit.auto-after-edit',
    'git.undo.restore-and-reset',
    'git.commands.raw-git',
    'git.diff.cmd-display',
  ),
  'behavioral-and-documentation-mismatches': rows(
    'git.commit.attribution',
    'git.undo.restore-and-reset',
    'git.dirty.path-semantics',
    'git.commands.raw-git',
  ),
  'dry-run-is-not-a-global-transaction-guard': rows('git.dry-run.skips-commits', 'git.commit.auto-after-edit'),
  'failure-modes-and-recovery-boundaries': rows(
    'git.repo.unavailable',
    'git.repo.open-single-root',
    'git.startup.sanity-check',
    'git.undo.preconditions',
    'git.commit.verify-flag',
    'git.hooks.pre-commit-boundary',
  ),
  'security-and-trust-boundaries': rows(
    'git.security.path-trust',
    'git.commands.add-refuses-outside-root',
    'git.commands.raw-git',
    'git.hooks.pre-commit-boundary',
    'git.filter.gitignore',
  ),
  'architecture-rationale-and-trade-offs': rows(
    'git.commit.auto-after-edit',
    'git.dirty.checkpoint-before-edit',
    'git.commit.selected-files-only',
    'git.undo.restore-and-reset',
    'git.inventory.tracked-files',
  ),
  'retained-artifacts': nonclaim('evidence', 'pointer to git evidence directory artifacts'),
  'existing-tests-executed': nonclaim('evidence', 'recorded existing-test execution totals'),
  'synthetic-experiment-results': rows(
    'git.inventory.tracked-files',
    'git.commit.selected-files-only',
    'git.dirty.path-semantics',
    'git.undo.preconditions',
    'git.diff.detached-and-unborn',
    'git.commit.attribution',
    'git.hooks.pre-commit-boundary',
    'git.worktree.linked-and-index',
  ),
  'reproduction-commands': nonclaim('evidence', 'reproduction commands for local verification'),
  'coverage-matrix-and-limitations': nonclaim('meta', 'coverage matrix and investigation limits'),
  'final-assessment': rows(
    'git.dirty.checkpoint-before-edit',
    'git.commit.auto-after-edit',
    'git.undo.preconditions',
    'git.inventory.tracked-files',
  ),
};

// Unit-level overrides where a section mixes nonclaim with behavior.
const UNIT_OVERRIDES = {
  'git/direct-and-transitive-dependency-responsibilities/p1': nonclaim('evidence', 'dependency path prefix for the verification venv'),
  'git/synthetic-experiment-results/p1': nonclaim('evidence', 'probe experiment pass count'),
  'git/what-this-reconstruction-establishes/p3': nonclaim('meta', 'document scope statement without a new observable'),
};

const EVIDENCE_RULES = {
  'ev-git/probe/aiderignore-cache-deletion': rows('git.filter.aiderignore'),
  'ev-git/probe/all-file-commit-uses-tracked-changes-and-staged-additions': rows(
    'git.commit.stage-whole-files',
    'git.inventory.tracked-files',
  ),
  'ev-git/probe/attribution-and-prefix-behavior': rows('git.commit.attribution'),
  'ev-git/probe/cli-defaults': rows('git.config.auto-commits', 'git.commit.attribution'),
  'ev-git/probe/coder-dirty-checkpoint-and-auto-commit': rows(
    'git.dirty.checkpoint-before-edit',
    'git.commit.auto-after-edit',
  ),
  'ev-git/probe/commit-message-model-fallback': rows('git.commit.message-context'),
  'ev-git/probe/detached-branch-diff': rows('git.diff.detached-and-unborn', 'git.diff.for-commit-message'),
  'ev-git/probe/dry-run-dirty-checkpoint': rows('git.dry-run.skips-commits', 'git.dirty.checkpoint-before-edit'),
  'ev-git/probe/index-version-3': rows('git.startup.sanity-check', 'git.worktree.linked-and-index'),
  'ev-git/probe/index-version-4': rows('git.startup.sanity-check', 'git.worktree.linked-and-index'),
  'ev-git/probe/inventory-semantics': rows('git.inventory.tracked-files', 'git.dirty.path-semantics'),
  'ev-git/probe/linked-worktree': rows('git.worktree.linked-and-index', 'git.startup.discover-root'),
  'ev-git/probe/new-unstaged-file-message-input': rows('git.diff.for-commit-message', 'git.commit.message-context'),
  'ev-git/probe/pre-commit-hook-boundary': rows('git.hooks.pre-commit-boundary', 'git.commit.verify-flag'),
  'ev-git/probe/raw-git-command-execution': rows('git.commands.raw-git'),
  'ev-git/probe/repository-discovery': rows('git.startup.discover-root', 'git.repo.open-single-root'),
  'ev-git/probe/selected-commit-excludes-unrelated-staged-files': rows('git.commit.selected-files-only'),
  'ev-git/probe/subtree-filtering': rows('git.filter.subtree'),
  'ev-git/probe/symlink-path-resolution': rows('git.security.path-trust'),
  'ev-git/probe/unborn-branch-diff': rows('git.diff.detached-and-unborn'),
  'ev-git/probe/undo-preserves-unrelated-dirt': rows('git.undo.restore-and-reset', 'git.undo.preconditions'),
  'ev-git/probe/undo-refuses-added-file': rows('git.undo.preconditions'),
  'ev-git/probe/undo-remote-tracking-equality-guard': rows('git.undo.preconditions'),
};

const TEST_RULES = {
  'aider-test/test_coder/TestCoder.test_allowed_to_edit': rows('git.authorize.stage-new-file', 'git.filter.gitignore'),
  'aider-test/test_coder/TestCoder.test_allowed_to_edit_no': rows('git.authorize.stage-new-file'),
  'aider-test/test_coder/TestCoder.test_allowed_to_edit_dirty': rows('git.dirty.checkpoint-before-edit'),
  'aider-test/test_coder/TestCoder.test_check_for_filename_mentions': rows('git.mentions.add-and-reflect'),
  'aider-test/test_coder/TestCoder.test_new_file_edit_one_commit': rows(
    'git.authorize.stage-new-file',
    'git.commit.auto-after-edit',
  ),
  'aider-test/test_coder/TestCoder.test_only_commit_gpt_edited_file': rows('git.commit.selected-files-only'),
  'aider-test/test_coder/TestCoder.test_gpt_edit_to_dirty_file': rows(
    'git.dirty.checkpoint-before-edit',
    'git.commit.auto-after-edit',
  ),
  'aider-test/test_coder/TestCoder.test_gpt_edit_to_existing_file_not_in_repo': rows('git.authorize.stage-new-file'),
  'aider-test/test_coder/TestCoder.test_skip_aiderignored_files': rows('git.filter.aiderignore'),
  'aider-test/test_coder/TestCoder.test_skip_gitignored_files_on_init': rows('git.filter.gitignore', 'git.authorize.skip-gitignored'),
  'aider-test/test_coder/TestCoder.test_coder_from_coder_with_subdir': rows('git.startup.discover-root', 'git.filter.subtree'),
  'aider-test/test_commands/TestCommands.test_cmd_git': rows('git.commands.raw-git'),
  'aider-test/test_commands/TestCommands.test_cmd_add_from_subdir': rows('git.commands.add-from-subdir'),
  'aider-test/test_commands/TestCommands.test_cmd_add_from_subdir_again': rows('git.commands.add-from-subdir'),
  'aider-test/test_commands/TestCommands.test_cmd_commit': rows('git.commands.commit', 'git.commit.stage-whole-files'),
  'aider-test/test_commands/TestCommands.test_cmd_add_from_outside_git': rows('git.commands.add-refuses-outside-root'),
  'aider-test/test_commands/TestCommands.test_cmd_add_dirname_with_special_chars_git': rows('git.commands.add-from-subdir'),
  'aider-test/test_commands/TestCommands.test_cmd_add_existing_with_dirty_repo': rows(
    'git.commands.add-from-subdir',
    'git.dirty.path-semantics',
  ),
  'aider-test/test_commands/TestCommands.test_cmd_add_read_only_file': rows('git.inventory.addable-files'),
  'aider-test/test_commands/TestCommands.test_cmd_add_drop_untracked_files': rows('git.commands.add-untracked'),
  'aider-test/test_commands/TestCommands.test_cmd_undo_with_dirty_files_not_in_last_commit': rows('git.undo.preconditions'),
  'aider-test/test_commands/TestCommands.test_cmd_undo_with_newly_committed_file': rows(
    'git.undo.restore-and-reset',
    'git.undo.preconditions',
  ),
  'aider-test/test_commands/TestCommands.test_cmd_undo_on_first_commit': rows('git.undo.preconditions'),
  'aider-test/test_commands/TestCommands.test_cmd_add_gitignored_file': rows('git.commands.add-ignore-policy', 'git.filter.gitignore'),
  'aider-test/test_commands/TestCommands.test_cmd_add_aiderignored_file': rows(
    'git.commands.add-ignore-policy',
    'git.filter.aiderignore',
  ),
  'aider-test/test_commands/TestCommands.test_cmd_read_only_from_working_dir': rows('git.inventory.addable-files'),
  'aider-test/test_commands/TestCommands.test_cmd_diff': rows('git.diff.cmd-display'),
  'aider-test/test_commands/TestCommands.test_cmd_weak_model': rows('git.commit.message-context'),
  'aider-test/test_main/TestMain.test_main_with_empty_git_dir_new_file': rows('git.startup.setup-repo', 'git.startup.discover-root'),
  'aider-test/test_main/TestMain.test_main_with_empty_git_dir_new_files': rows('git.startup.setup-repo', 'git.startup.discover-root'),
  'aider-test/test_main/TestMain.test_main_with_dname_and_fname': rows('git.startup.discover-root'),
  'aider-test/test_main/TestMain.test_main_with_subdir_repo_fnames': rows('git.startup.discover-root', 'git.filter.subtree'),
  'aider-test/test_main/TestMain.test_main_with_git_config_yml': rows('git.config.auto-commits'),
  'aider-test/test_main/TestMain.test_main_with_empty_git_dir_new_subdir_file': rows('git.startup.setup-repo'),
  'aider-test/test_main/TestMain.test_setup_git': rows('git.startup.setup-repo'),
  'aider-test/test_main/TestMain.test_check_gitignore': rows('git.config.gitignore-offer'),
  'aider-test/test_main/TestMain.test_command_line_gitignore_files_flag': rows('git.config.gitignore-offer'),
  'aider-test/test_main/TestMain.test_add_command_gitignore_files_flag': rows('git.config.gitignore-offer', 'git.filter.gitignore'),
  'aider-test/test_main/TestMain.test_main_args': rows('git.config.auto-commits'),
  'aider-test/test_main/TestMain.test_false_vals_in_env_file': rows('git.config.auto-commits'),
  'aider-test/test_main/TestMain.test_true_vals_in_env_file': rows('git.config.auto-commits'),
  'aider-test/test_main/TestMain.test_git_config_include': rows('git.config.auto-commits'),
  'aider-test/test_main/TestMain.test_git_config_include_directive': rows('git.config.auto-commits'),
  'aider-test/test_main/TestMain.test_resolve_aiderignore_path': rows('git.config.aiderignore-path'),
  'aider-test/test_main/TestMain.test_commit_language_japanese': rows('git.commit.message-language'),
  'aider-test/test_main/TestMain.test_main_exit_with_git_command_not_found': rows('git.repo.unavailable'),
  'aider-test/test_main/TestMain.test_argv_file_respects_git': rows('git.startup.discover-root', 'git.filter.gitignore'),
  'aider-test/test_repo/TestRepo.test_diffs_empty_repo': rows('git.diff.for-commit-message', 'git.commit.noop-when-clean'),
  'aider-test/test_repo/TestRepo.test_diffs_nonempty_repo': rows('git.diff.for-commit-message'),
  'aider-test/test_repo/TestRepo.test_diffs_with_single_byte_encoding': rows('git.diff.for-commit-message'),
  'aider-test/test_repo/TestRepo.test_diffs_detached_head': rows('git.diff.detached-and-unborn'),
  'aider-test/test_repo/TestRepo.test_diffs_between_commits': rows('git.diff.for-commit-message', 'git.diff.cmd-display'),
  'aider-test/test_repo/TestRepo.test_get_commit_message': rows('git.commit.message-context'),
  'aider-test/test_repo/TestRepo.test_get_commit_message_strip_quotes': rows('git.commit.message-context'),
  'aider-test/test_repo/TestRepo.test_get_commit_message_no_strip_unmatched_quotes': rows('git.commit.message-context'),
  'aider-test/test_repo/TestRepo.test_get_commit_message_with_custom_prompt': rows('git.commit.message-context'),
  'aider-test/test_repo/TestRepo.test_commit_with_custom_committer_name': rows('git.commit.attribution'),
  'aider-test/test_repo/TestRepo.test_commit_with_co_authored_by': rows('git.commit.attribution'),
  'aider-test/test_repo/TestRepo.test_commit_co_authored_by_with_explicit_name_modification': rows('git.commit.attribution'),
  'aider-test/test_repo/TestRepo.test_commit_ai_edits_no_coauthor_explicit_false': rows('git.commit.attribution'),
  'aider-test/test_repo/TestRepo.test_get_tracked_files': rows('git.inventory.tracked-files'),
  'aider-test/test_repo/TestRepo.test_get_tracked_files_with_new_staged_file': rows('git.inventory.tracked-files'),
  'aider-test/test_repo/TestRepo.test_get_tracked_files_with_aiderignore': rows(
    'git.inventory.tracked-files',
    'git.filter.aiderignore',
  ),
  'aider-test/test_repo/TestRepo.test_get_tracked_files_from_subdir': rows('git.inventory.tracked-files', 'git.filter.subtree'),
  'aider-test/test_repo/TestRepo.test_subtree_only': rows('git.filter.subtree'),
  'aider-test/test_repo/TestRepo.test_noop_commit': rows('git.commit.noop-when-clean'),
  'aider-test/test_repo/TestRepo.test_git_commit_verify': rows('git.commit.verify-flag'),
  'aider-test/test_repo/TestRepo.test_get_commit_message_uses_system_prompt_prefix': rows('git.commit.message-context'),
  'aider-test/test_sanity_check_repo/test_detached_head_state': rows('git.startup.sanity-check', 'git.diff.detached-and-unborn'),
  'aider-test/test_sanity_check_repo/test_git_index_version_greater_than_2': rows(
    'git.startup.sanity-check',
    'git.worktree.linked-and-index',
  ),
  'aider-test/test_sanity_check_repo/test_bare_repository': rows('git.startup.sanity-check'),
  'aider-test/test_sanity_check_repo/test_sanity_check_repo_with_corrupt_repo': rows('git.startup.sanity-check'),
  'aider-test/test_sanity_check_repo/test_sanity_check_repo_with_no_repo': rows('git.startup.sanity-check', 'git.repo.open-single-root'),
};

function mapUnit(unit) {
  if (UNIT_OVERRIDES[unit.id]) return UNIT_OVERRIDES[unit.id];
  if (TEST_RULES[unit.id]) return TEST_RULES[unit.id];
  if (EVIDENCE_RULES[unit.id]) return EVIDENCE_RULES[unit.id];
  if (unit.id.startsWith('git/')) {
    const section = unit.id.split('/')[1];
    const rule = SECTION_RULES[section];
    if (!rule) throw new Error(`no SECTION_RULES entry for ${section} (${unit.id})`);
    return rule;
  }
  if (unit.id.startsWith('ev-git/')) throw new Error(`no EVIDENCE_RULES entry for ${unit.id}`);
  if (unit.id.startsWith('aider-test/')) throw new Error(`no TEST_RULES entry for ${unit.id}`);
  throw new Error(`unexpected git-slice unit ${unit.id}`);
}

function openRowRecord(spec) {
  return {
    id: spec.id,
    feature: 'git',
    behavior: spec.behavior,
    aider: spec.aider,
    kind: 'parity',
    status: 'open',
    pi: [],
    src: [],
    tests: [],
  };
}

function main() {
  const units = census().filter((unit) => sliceOf(unit.id) === 'git');
  const ledger = readJson('parity/ledger.json');
  const coverage = readJson('parity/coverage.json');

  for (const row of ledger.rows) {
    if (VERIFIED.has(row.id) && row.status !== 'verified') {
      throw new Error(`refusing to proceed: verified row ${row.id} is ${row.status}`);
    }
  }

  const existingById = new Map(ledger.rows.map((row) => [row.id, row]));
  const openRecords = OPEN_ROWS.map(openRowRecord);
  for (const row of openRecords) {
    if (VERIFIED.has(row.id)) throw new Error(`open row collides with verified id: ${row.id}`);
    const prior = existingById.get(row.id);
    if (prior && prior.status === 'verified') throw new Error(`refusing to overwrite verified row ${row.id}`);
  }

  const gitCoverage = {};
  for (const unit of units) {
    gitCoverage[unit.id] = mapUnit(unit);
  }

  const referenced = new Set();
  for (const entry of Object.values(gitCoverage)) {
    for (const id of entry.rows ?? []) referenced.add(id);
  }
  for (const row of openRecords) {
    if (!referenced.has(row.id)) throw new Error(`open row ${row.id} is not referenced by any git-slice unit`);
  }
  for (const id of VERIFIED) {
    if (!referenced.has(id)) throw new Error(`verified row ${id} has no git-slice coverage reference`);
  }
  const knownIds = new Set([...existingById.keys(), ...openRecords.map((row) => row.id)]);
  for (const id of referenced) {
    if (!knownIds.has(id)) throw new Error(`coverage references unknown row ${id}`);
  }

  // Merge: keep non-git keys; replace any prior git-slice keys from this generator.
  const nextCoverage = { ...coverage };
  for (const id of Object.keys(nextCoverage)) {
    if (sliceOf(id) === 'git') delete nextCoverage[id];
  }
  Object.assign(nextCoverage, gitCoverage);

  const openIds = new Set(openRecords.map((row) => row.id));
  const retained = ledger.rows.filter((row) => !openIds.has(row.id));
  const nextLedger = {
    ...ledger,
    rows: [...retained, ...openRecords],
  };

  writeJson('parity/coverage.json', nextCoverage);
  writeJson('parity/ledger.json', nextLedger);

  const covered = units.filter((unit) => Object.hasOwn(nextCoverage, unit.id)).length;
  process.stdout.write(
    `map-git-obligations: slice ${units.length}, covered ${covered}, open rows added ${openRecords.length}, git rows total ${12 + openRecords.length}\n`,
  );
}

main();
