import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const canon = (path: string) => realpathSync(path);

import { BRANDING } from '../../src/branding.ts';
import type { Host } from '../../src/core/host.ts';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { createGitPolicy } from '../../src/git/policy.ts';
import {
  checkGitignore,
  discoverGitRoot,
  openSingleRoot,
  prepareGitRepository,
  sanityCheckRepo,
  setupGit,
} from '../../src/git/startup.ts';
import { findGitRoot } from '../../src/settings/config-files.ts';
import { commitFile, initRepo, recordingHost, tempDir } from './support.ts';

function confirmingHost(answer: boolean | ((question: string) => boolean) = true): Host & {
  readonly outputs: string[];
  readonly errors: string[];
  readonly warnings: string[];
  readonly confirms: string[];
} {
  const base = recordingHost();
  const confirms: string[] = [];
  return {
    ...base,
    confirms,
    confirm: async (request) => {
      confirms.push(request.question);
      return typeof answer === 'function' ? answer(request.question) : answer;
    },
  };
}

async function git(root: string, args: string[]): Promise<void> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const outcome = await isolatedExec({ command: 'git', args, cwd: root }, env);
  if (outcome.code !== 0) throw new Error(`git ${args.join(' ')}: ${outcome.stderr || outcome.stdout}`);
}

test(
  'discoverGitRoot finds the repository from a subdirectory the way findGitRoot does',
  { meta: { aider: ['test_main/TestMain.test_main_with_subdir_repo_fnames', 'test_coder/TestCoder.test_coder_from_coder_with_subdir'] } },
  async () => {
    const root = await tempDir('git-discover-');
    await initRepo(root);
    const nested = join(root, 'pkg', 'nested');
    await mkdir(nested, { recursive: true });
    expect(discoverGitRoot(nested)).toBe(canon(root));
    expect(discoverGitRoot(nested)).toBe(canon(findGitRoot(nested)!));
    expect(discoverGitRoot(await tempDir('git-no-repo-'))).toBe(null);
  },
);

test(
  'openSingleRoot returns one root and refuses zero or multiple roots',
  { meta: { aider: ['test_sanity_check_repo/test_sanity_check_repo_with_no_repo'] } },
  async () => {
    const a = await tempDir('git-open-a-');
    const b = await tempDir('git-open-b-');
    await initRepo(a);
    await initRepo(b);
    const host = recordingHost();
    expect(await openSingleRoot(host, [a])).toEqual({ kind: 'ok', root: canon(a) });
    expect(await openSingleRoot(host, [await tempDir('git-open-none-')])).toEqual({ kind: 'none' });
    const multi = await openSingleRoot(host, [a, b]);
    expect(multi).toEqual({ kind: 'multiple' });
    expect(host.errors).toContain('Files are in different git repos.');
  },
);

test(
  'setupGit offers init outside home, creates ignore patterns without a second confirm, and skips the home directory',
  { meta: { aider: ['test_main/TestMain.test_setup_git', 'test_main/TestMain.test_main_with_empty_git_dir_new_file'] } },
  async () => {
    const root = await tempDir('git-setup-');
    const host = confirmingHost(true);
    const created = await setupGit(host, root, homedir());
    expect(created).toBe(canon(root));
    expect(host.confirms).toEqual(['No git repo found, create one to track aider\'s changes (recommended)?']);
    expect(host.outputs).toContain(`Git repository created in ${canon(root)}`);
    const ignore = await readFile(join(root, '.gitignore'), 'utf8');
    expect(ignore.split('\n')[0]).toBe(BRANDING.gitignorePattern);
    expect(host.confirms).toHaveLength(1);

    const home = await tempDir('git-home-');
    const homeHost = confirmingHost(true);
    expect(await setupGit(homeHost, home, home)).toBe(null);
    expect(homeHost.warnings).toContain("You should probably run aider in your project's directory, not your home dir.");
    expect(homeHost.confirms).toEqual([]);
  },
);

test(
  'sanityCheckRepo refuses bare, corrupt, and index versions above 2, and accepts detached HEAD',
  { meta: { aider: ['test_sanity_check_repo/test_bare_repository', 'test_sanity_check_repo/test_sanity_check_repo_with_corrupt_repo', 'test_sanity_check_repo/test_git_index_version_greater_than_2', 'test_sanity_check_repo/test_detached_head_state'] } },
  async () => {
    const bare = await tempDir('git-bare-');
    await git(bare, ['init', '--bare']);
    const bareHost = recordingHost();
    expect(await sanityCheckRepo(bareHost, bare)).toBe(false);
    expect(bareHost.errors).toContain('The git repo does not seem to have a working tree?');

    const corrupt = await tempDir('git-corrupt-');
    await initRepo(corrupt);
    await git(corrupt, ['commit', '--allow-empty', '-m', 'empty']).catch(() => undefined);
    const { rm } = await import('node:fs/promises');
    await rm(join(corrupt, '.git'), { recursive: true, force: true });
    await mkdir(join(corrupt, '.git'));
    const corruptHost = recordingHost();
    expect(await sanityCheckRepo(corruptHost, corrupt)).toBe(false);
    expect(corruptHost.errors).toContain('Unable to read git repository, it may be corrupt?');

    const indexed = await tempDir('git-index-');
    await initRepo(indexed);
    await commitFile(indexed, 'README.md', '# hi');
    const indexPath = join(indexed, '.git', 'index');
    const buf = Buffer.from(await readFile(indexPath));
    buf.writeUInt32BE(3, 4);
    await writeFile(indexPath, buf);
    const indexHost = recordingHost();
    expect(await sanityCheckRepo(indexHost, indexed)).toBe(false);
    expect(indexHost.errors).toContain('Aider only works with git repos with version number 1 or 2.');
    expect(indexHost.outputs).toContain('You may be able to convert your repo: git update-index --index-version=2');
    expect(indexHost.outputs).toContain('Or run aider --no-git to proceed without using git.');

    const detached = await tempDir('git-detach-');
    await initRepo(detached);
    await commitFile(detached, 'a.txt', 'a');
    const head = (await isolatedExec({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: detached }, Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)))).stdout.trim();
    await git(detached, ['checkout', head]);
    const detachHost = recordingHost();
    expect(await sanityCheckRepo(detachHost, detached)).toBe(true);
    expect(detachHost.errors).toEqual([]);
  },
);

test(
  'checkGitignore offers to append branding and .env patterns when --gitignore is on',
  { meta: { aider: ['test_main/TestMain.test_check_gitignore'] } },
  async () => {
    const root = await tempDir('git-ignore-offer-');
    await initRepo(root);
    const host = confirmingHost(true);
    await checkGitignore(host, root, true);
    expect(host.outputs).toContain('You can skip this check with --no-gitignore');
    expect(host.confirms[0]).toContain(`Add ${BRANDING.gitignorePattern} to .gitignore (recommended)?`);
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(`${BRANDING.gitignorePattern}\n`);

    await writeFile(join(root, '.gitignore'), 'one\ntwo\n');
    await writeFile(join(root, '.env'), 'X=1\n');
    const again = confirmingHost(true);
    await checkGitignore(again, root, true);
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(`one\ntwo\n${BRANDING.gitignorePattern}\n.env\n`);
  },
);

test(
  'prepareGitRepository disables when git is off or the executable is missing, and opens a ready root otherwise',
  { meta: { aider: ['test_main/TestMain.test_main_exit_with_git_command_not_found'] } },
  async () => {
    const root = await tempDir('git-prep-');
    await initRepo(root);
    await commitFile(root, 'f.txt', 'f');
    const off = await prepareGitRepository({
      host: recordingHost(),
      cwd: root,
      home: homedir(),
      gitEnabled: false,
      gitignoreOffer: true,
    });
    expect(off).toEqual({ kind: 'disabled' });

    const missing = confirmingHost(true);
    missing.exec = async () => ({ stdout: '', stderr: 'Command git not found', code: 127, killed: false });
    const unavailable = await prepareGitRepository({
      host: missing,
      cwd: root,
      home: homedir(),
      gitEnabled: true,
      gitignoreOffer: false,
    });
    expect(unavailable).toEqual({ kind: 'disabled' });

    const readyHost = confirmingHost(false);
    const ready = await prepareGitRepository({
      host: readyHost,
      cwd: root,
      home: homedir(),
      gitEnabled: true,
      gitignoreOffer: true,
    });
    expect(ready).toEqual({ kind: 'ready', root: canon(root) });
    const policy = createGitPolicy({
      host: readyHost,
      cwd: root,
      repoRoot: ready.kind === 'ready' ? ready.root : null,
      settings: {
        autoCommits: true,
        dirtyCommits: true,
        gitCommitVerify: false,
        attributeAuthor: null,
        attributeCommitter: null,
        attributeCommitMessageAuthor: false,
        attributeCommitMessageCommitter: false,
        attributeCoAuthoredBy: false,
        commitPrompt: null,
        aiderIgnore: null,
        subtreeOnly: false,
        commitLanguage: null,
      },
    });
    expect(policy.repoRoot()).toBe(canon(root));
  },
);

test(
  'linked worktrees discover and pass sanity through the same Host.exec path',
  { meta: { aider: ['ev-git/probe/linked-worktree'] } },
  async () => {
    const main = await tempDir('git-wt-main-');
    await initRepo(main);
    await commitFile(main, 'tracked.txt', 'ok');
    const linked = await tempDir('git-wt-link-');
    await git(main, ['worktree', 'add', '--detach', linked, 'HEAD']);
    expect(discoverGitRoot(linked)).toBe(canon(linked));
    const host = recordingHost();
    expect(await sanityCheckRepo(host, linked)).toBe(true);
    const opened = await openSingleRoot(host, [linked]);
    expect(opened).toEqual({ kind: 'ok', root: canon(linked) });
    const policy = createGitPolicy({
      host,
      cwd: linked,
      repoRoot: canon(linked),
      settings: {
        autoCommits: true,
        dirtyCommits: true,
        gitCommitVerify: false,
        attributeAuthor: null,
        attributeCommitter: null,
        attributeCommitMessageAuthor: false,
        attributeCommitMessageCommitter: false,
        attributeCoAuthoredBy: false,
        commitPrompt: null,
        aiderIgnore: null,
        subtreeOnly: false,
        commitLanguage: null,
      },
    });
    expect(await policy.trackedFiles()).toContain('tracked.txt');
  },
);
