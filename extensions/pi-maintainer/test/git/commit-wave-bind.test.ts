import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { BRANDING, coAuthoredBy } from '../../src/branding.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type GitPolicy, registerEditFormat } from '../../src/feature.ts';
import { buildCommitMessageRequest } from '../../src/git/commit-message.ts';
import { gitOptionList, gitOptions } from '../../src/git/options.ts';
import { loadSettings } from '../../src/settings/load.ts';
import { commitFile, initRepo, policyIn, recordingHost, tempDir } from './support.ts';

const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));

async function git(root: string, args: string[]): Promise<string> {
  const outcome = await isolatedExec({ command: 'git', args, cwd: root }, env);
  if (outcome.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${outcome.stderr || outcome.stdout}`);
  return outcome.stdout;
}

test('pathless isDirty ignores untracked files while a missing inventory path is dirty', {
  meta: {
    aider: ['test_commands/TestCommands.test_cmd_add_existing_with_dirty_repo'],
    evidence: ['ev-git/probe/inventory-semantics'],
  },
}, async () => {
  const root = await tempDir('git-dirty-path-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'tracked.py', 'ok\n', 'seed');
  await writeFile(join(root, 'stray.py'), 'untracked\n');
  const gitPolicy = policyIn(root, host);
  expect(await gitPolicy.isDirty()).toBe(false);
  expect(await gitPolicy.isDirty('stray.py')).toBe(true);
  await writeFile(join(root, 'tracked.py'), 'dirty\n');
  expect(await gitPolicy.isDirty()).toBe(true);
  expect(await gitPolicy.isDirty('tracked.py')).toBe(true);
});

test('autoCommit is a noop without a model call when the selection is empty or the diff is empty', {
  meta: {
    aider: ['test_repo/TestRepo.test_noop_commit', 'test_repo/TestRepo.test_diffs_empty_repo'],
  },
}, async () => {
  let modelCalls = 0;
  const root = await tempDir('git-noop-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'clean.py', 'same\n', 'seed');
  const gitPolicy = policyIn(
    root,
    host,
    {},
    {
      generateCommitMessage: async () => {
        modelCalls += 1;
        return 'should not run';
      },
    },
  );
  expect(await gitPolicy.autoCommit(new Set(), { kind: 'conversation', text: 'nothing' })).toEqual({ kind: 'unchanged' });
  expect(await gitPolicy.autoCommit(new Set(['clean.py']), { kind: 'conversation', text: 'nothing' })).toEqual({ kind: 'unchanged' });
  expect(modelCalls).toBe(0);
});

test('git-commit-verify off passes --no-verify so a failing pre-commit hook does not block', {
  meta: {
    aider: ['test_repo/TestRepo.test_git_commit_verify'],
    evidence: ['ev-git/probe/pre-commit-hook-boundary'],
  },
}, async () => {
  const root = await tempDir('git-verify-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'hooked.py', 'before\n', 'seed');
  const hooks = join(root, '.git', 'hooks');
  await mkdir(hooks, { recursive: true });
  const hook = join(hooks, 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  await writeFile(join(root, 'hooked.py'), 'after\n');

  const blocked = policyIn(root, host, { gitCommitVerify: true }, { generateCommitMessage: async () => 'blocked' });
  expect(await blocked.autoCommit(new Set(['hooked.py']), { kind: 'conversation', text: 'edit' })).toMatchObject({ kind: 'failed' });

  const allowed = policyIn(root, host, { gitCommitVerify: false }, { generateCommitMessage: async () => 'allowed' });
  const result = await allowed.autoCommit(new Set(['hooked.py']), { kind: 'conversation', text: 'edit' });
  expect(result).toMatchObject({ kind: 'committed', message: 'allowed' });
  expect((await git(root, ['log', '-1', '--pretty=%s'])).trim()).toBe('allowed');
});

test('pre-commit hooks remain a trust boundary when verify is on', {
  meta: {
    aider: ['test_repo/TestRepo.test_git_commit_verify'],
    evidence: ['ev-git/probe/pre-commit-hook-boundary'],
  },
}, async () => {
  const root = await tempDir('git-hook-bound-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.py', '1\n', 'seed');
  const hooks = join(root, '.git', 'hooks');
  await mkdir(hooks, { recursive: true });
  const hook = join(hooks, 'pre-commit');
  await writeFile(hook, '#!/bin/sh\necho hook-ran >&2\nexit 1\n');
  await chmod(hook, 0o755);
  await writeFile(join(root, 'a.py'), '2\n');
  const gitPolicy = policyIn(root, host, { gitCommitVerify: true }, { generateCommitMessage: async () => 'hooked' });
  const result = await gitPolicy.autoCommit(new Set(['a.py']), { kind: 'conversation', text: 'edit' });
  expect(result.kind).toBe('failed');
  expect(host.errors.some((line) => line.includes('Unable to commit'))).toBe(true);
  expect((await git(root, ['log', '-1', '--pretty=%s'])).trim()).toBe('seed');
});

test('assistant commits apply co-authored-by and optional name attribution from CLI defaults', {
  meta: {
    aider: [
      'test_repo/TestRepo.test_commit_with_co_authored_by',
      'test_repo/TestRepo.test_commit_with_custom_committer_name',
      'test_repo/TestRepo.test_commit_co_authored_by_with_explicit_name_modification',
      'test_repo/TestRepo.test_commit_ai_edits_no_coauthor_explicit_false',
    ],
    evidence: ['ev-git/probe/attribution-and-prefix-behavior', 'ev-git/probe/cli-defaults'],
  },
}, async () => {
  const root = await tempDir('git-attr-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'file.txt', 'old\n', 'seed');
  await writeFile(join(root, 'file.txt'), 'new\n');
  const coauthored = policyIn(root, host, { attributeCoAuthoredBy: true, attributeAuthor: null, attributeCommitter: null }, { generateCommitMessage: async () => 'Aider edit' });
  expect(await coauthored.autoCommit(new Set(['file.txt']), { kind: 'conversation', text: 'edit' })).toMatchObject({ kind: 'committed' });
  const message = await git(root, ['log', '-1', '--pretty=%B']);
  expect(message).toContain(coAuthoredBy('unknown-model'));
  expect((await git(root, ['log', '-1', '--pretty=%an'])).trim()).toBe('Test User');
  expect((await git(root, ['log', '-1', '--pretty=%cn'])).trim()).toBe('Test User');

  await writeFile(join(root, 'file.txt'), 'again\n');
  const named = policyIn(
    root,
    host,
    {
      attributeCoAuthoredBy: false,
      attributeAuthor: true,
      attributeCommitter: true,
      attributeCommitMessageAuthor: true,
    },
    { generateCommitMessage: async () => 'named edit' },
  );
  expect(await named.autoCommit(new Set(['file.txt']), { kind: 'conversation', text: 'edit' })).toMatchObject({ kind: 'committed' });
  expect((await git(root, ['log', '-1', '--pretty=%s'])).trim()).toBe(`${BRANDING.messagePrefix}named edit`);
  expect((await git(root, ['log', '-1', '--pretty=%an'])).trim()).toBe(`Test User${BRANDING.nameSuffix}`);
  expect((await git(root, ['log', '-1', '--pretty=%cn'])).trim()).toBe(`Test User${BRANDING.nameSuffix}`);
});

test('commit-message generation respects the configured commit language', { meta: { aider: ['test_main/TestMain.test_commit_language_japanese'] } }, async () => {
  const seen: { system: string; user: string }[] = [];
  const root = await tempDir('git-lang-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'a.py', 'one\n', 'seed');
  await writeFile(join(root, 'a.py'), 'two\n');
  const gitPolicy = policyIn(
    root,
    host,
    { commitLanguage: 'japanese' },
    {
      generateCommitMessage: async (request) => {
        seen.push(request);
        return 'feat: update';
      },
    },
  );
  expect(await gitPolicy.autoCommit(new Set(['a.py']), { kind: 'conversation', text: 'change' })).toMatchObject({ kind: 'committed' });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.system).toContain('Is written in japanese.');
  expect(buildCommitMessageRequest('diff', null, { userLanguage: 'japanese' }).system).toContain('Is written in japanese.');
});

test('a selected-file commit leaves unrelated staged and dirty files untouched', {
  meta: {
    aider: ['test_coder/TestCoder.test_only_commit_gpt_edited_file'],
    evidence: ['ev-git/probe/selected-commit-excludes-unrelated-staged-files'],
  },
}, async () => {
  const root = await tempDir('git-selected-');
  const host = recordingHost();
  await initRepo(root);
  await commitFile(root, 'edited.py', 'old\n', 'seed');
  await commitFile(root, 'other.py', 'keep\n', 'other');
  await writeFile(join(root, 'edited.py'), 'new\n');
  await writeFile(join(root, 'other.py'), 'staged dirty\n');
  await git(root, ['add', '--', 'other.py']);
  const beforeOther = await git(root, ['status', '--porcelain', '--', 'other.py']);
  const gitPolicy = policyIn(root, host, {}, { generateCommitMessage: async () => 'feat: edit one' });
  expect(await gitPolicy.autoCommit(new Set(['edited.py']), { kind: 'conversation', text: 'edit' })).toMatchObject({
    kind: 'committed',
    message: 'feat: edit one',
  });
  const show = await git(root, ['show', 'HEAD:edited.py']);
  expect(show).toBe('new\n');
  const afterOther = await git(root, ['status', '--porcelain', '--', 'other.py']);
  expect(afterOther.trim()).toBe(beforeOther.trim());
  expect(afterOther.trim().length).toBeGreaterThan(0);
});

test('CLI env and YAML merge form the effective auto dirty and git option policy', {
  meta: {
    aider: [
      'test_main/TestMain.test_main_with_git_config_yml',
      'test_main/TestMain.test_main_args',
      'test_main/TestMain.test_false_vals_in_env_file',
      'test_main/TestMain.test_true_vals_in_env_file',
      'test_main/TestMain.test_git_config_include',
      'test_main/TestMain.test_git_config_include_directive',
    ],
    evidence: ['ev-git/probe/cli-defaults'],
  },
}, async () => {
  const home = await tempDir('git-cfg-home-');
  const cwd = await tempDir('git-cfg-cwd-');
  await writeFile(join(cwd, '.pi-maintainer.conf.yml'), 'auto-commits: false\ndirty-commits: true\ngit: true\n');
  const loaded = await loadSettings({
    specs: gitOptionList,
    getFlag: (name) => (name === 'git-commit-verify' ? true : undefined),
    processEnvironment: { PI_MAINTAINER_DIRTY_COMMITS: 'false' },
    cwd,
    home,
  });
  expect(loaded.settings.value(gitOptions.git)).toBe(true);
  expect(loaded.settings.value(gitOptions.autoCommits)).toBe(false);
  expect(loaded.settings.value(gitOptions.dirtyCommits)).toBe(false);
  expect(loaded.settings.value(gitOptions.gitCommitVerify)).toBe(true);
});

test('after applying edits the exchange auto-commits written files before lint follow-up', {
  meta: {
    aider: ['test_coder/TestCoder.test_new_file_edit_one_commit', 'test_coder/TestCoder.test_gpt_edit_to_dirty_file'],
    evidence: ['ev-git/probe/coder-dirty-checkpoint-and-auto-commit'],
  },
}, async () => {
  const root = await tempDir('git-auto-after-');
  await writeFile(join(root, 'target.txt'), 'before\n');
  const order: string[] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const format = registerEditFormat({
    name: 'whole',
    prompts: 'whole',
    editIntent: (edit) => edit[1],
    getEdits: () => [['target.txt', { kind: 'upsert' as const, path: 'target.txt' }]],
    applyEditsDryRun: (edits) => [...edits],
    applyEdits: async (edits, context) => {
      for (const [path] of edits) await context.tree.write(context.absRootPath(path), 'after\n');
    },
  });
  const git: GitPolicy = {
    ...disabledGitPolicy,
    autoCommit: async () => {
      order.push('commit');
      return { kind: 'committed', hash: 'abc1234', message: 'edit' };
    },
  };
  const controller = new ExchangeController(
    {
      schema: 1,
      kind: 'snapshot',
      root,
      mode: 'whole',
      phase: { kind: 'main' },
      files: { editable: [join(root, 'target.txt')], readOnly: [] },
      originalReadOnly: [],
      returnMode: null,
      ignoredMentions: [],
      neverAsk: [],
      lastUserEntry: 'user-1',
      historyThrough: null,
      physicalModel: { provider: 'test', id: 'scripted' },
      editorModel: null,
      weakModel: null,
      assistantCommits: [],
      lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
    },
    {
      ports: {
        edit: {
          formats: new Map([['whole', format]]),
          requestedFormat: 'whole',
          initialFiles: { editable: [], readOnly: [] },
          messageFile: null,
          applyFile: null,
          dryRun: false,
          yesAlways: true,
          autoAcceptArchitect: true,
          editorModel: null,
          chatLanguage: null,
          editorEditFormat: 'editor-whole',
          tree: createWorkingTree({ notices: host }),
        },
        git,
        map: disabledRepositoryContext,
        lint: {
          ...disabledValidation,
          lintEdited: async () => {
            order.push('lint');
            return { kind: 'disabled' };
          },
        },
      },
      host,
      source: {
        get: async () => ({
          mainSystem: 'MAIN',
          systemReminder: 'REMINDER',
          exampleMessages: [] as const,
          filesContentPrefix: 'EDITABLE',
          filesContentAssistantReply: 'Ok.',
          filesNoFullFiles: 'NONE',
          filesNoFullFilesWithRepoMap: '',
          filesNoFullFilesWithRepoMapReply: '',
          readOnlyFilesPrefix: 'READ ONLY',
          filesContentGptEditsNoRepo: 'saved',
        }),
      },
      append: () => {},
      suggestShellCommands: false,
    },
  );
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  await controller.completeReply({ kind: 'complete', id: 'reply-1', text: 'target.txt' });
  expect(order).toEqual(['commit', 'lint']);
  expect(controller.snapshot.assistantCommits).toEqual(['abc1234']);
});

test('dry-run skips auto-commit and dirty checkpoints', {
  meta: {
    evidence: ['ev-git/probe/dry-run-dirty-checkpoint'],
  },
}, async () => {
  const root = await tempDir('git-dry-');
  await writeFile(join(root, 'target.txt'), 'before\n');
  let commits = 0;
  let dirtyCheckpoints = 0;
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const format = registerEditFormat({
    name: 'whole',
    prompts: 'whole',
    editIntent: (edit) => edit[1],
    getEdits: () => [['target.txt', { kind: 'upsert' as const, path: 'target.txt' }]],
    applyEditsDryRun: (edits) => [...edits],
    applyEdits: async (edits, context) => {
      for (const [path] of edits) await context.tree.write(context.absRootPath(path), 'after\n');
    },
  });
  const controller = new ExchangeController(
    {
      schema: 1,
      kind: 'snapshot',
      root,
      mode: 'whole',
      phase: { kind: 'main' },
      files: { editable: [join(root, 'target.txt')], readOnly: [] },
      originalReadOnly: [],
      returnMode: null,
      ignoredMentions: [],
      neverAsk: [],
      lastUserEntry: 'user-1',
      historyThrough: null,
      physicalModel: { provider: 'test', id: 'scripted' },
      editorModel: null,
      weakModel: null,
      assistantCommits: [],
      lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
    },
    {
      ports: {
        edit: {
          formats: new Map([['whole', format]]),
          requestedFormat: 'whole',
          initialFiles: { editable: [], readOnly: [] },
          messageFile: null,
          applyFile: null,
          dryRun: true,
          yesAlways: true,
          autoAcceptArchitect: true,
          editorModel: null,
          chatLanguage: null,
          editorEditFormat: 'editor-whole',
          tree: createWorkingTree({ dryRun: true, notices: host }),
        },
        git: {
          ...disabledGitPolicy,
          needsDirtyCommit: async () => true,
          dirtyCommit: async () => {
            dirtyCheckpoints += 1;
            return { kind: 'protected' };
          },
          autoCommit: async () => {
            commits += 1;
            return { kind: 'committed', hash: 'deadbeef', message: 'nope' };
          },
        },
        map: disabledRepositoryContext,
        lint: disabledValidation,
      },
      host,
      source: {
        get: async () => ({
          mainSystem: 'MAIN',
          systemReminder: 'REMINDER',
          exampleMessages: [] as const,
          filesContentPrefix: 'EDITABLE',
          filesContentAssistantReply: 'Ok.',
          filesNoFullFiles: 'NONE',
          filesNoFullFilesWithRepoMap: '',
          filesNoFullFilesWithRepoMapReply: '',
          readOnlyFilesPrefix: 'READ ONLY',
          filesContentGptEditsNoRepo: '',
        }),
      },
      append: () => {},
      suggestShellCommands: false,
    },
  );
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  await controller.completeReply({ kind: 'complete', id: 'reply-dry', text: 'target.txt' });
  expect(commits).toBe(0);
  expect(dirtyCheckpoints).toBe(0);
  expect(controller.snapshot.assistantCommits).toEqual([]);
});
