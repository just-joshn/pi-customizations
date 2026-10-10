import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onTestFinished } from 'vitest';
import type { Host } from '../../src/core/host.ts';
import { isolatedExec } from '../../src/core/isolated-exec.ts';
import { createGitPolicy, type GitPolicySettings } from '../../src/git/policy.ts';

const defaultSettings: GitPolicySettings = {
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
};

export async function tempDir(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

export function recordingHost(): Host & { readonly outputs: string[]; readonly errors: string[]; readonly warnings: string[] } {
  const outputs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return {
    outputs,
    errors,
    warnings,
    output: (text) => {
      outputs.push(text);
    },
    warning: (text) => {
      warnings.push(text);
    },
    error: (text) => {
      errors.push(text);
    },
    confirm: async () => true,
    select: async () => undefined,
    exec: (request) => isolatedExec(request, env),
  };
}

export async function initRepo(root: string): Promise<void> {
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const run = async (args: string[]) => {
    const outcome = await isolatedExec({ command: 'git', args, cwd: root }, env);
    if (outcome.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${outcome.stderr || outcome.stdout}`);
  };
  await run(['init']);
  await run(['config', 'user.name', 'Test User']);
  await run(['config', 'user.email', 'test@example.com']);
}

export async function commitFile(root: string, relative: string, content: string, message = 'init'): Promise<void> {
  await writeFile(join(root, relative), content);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  for (const args of [['add', '--', relative], ['commit', '-m', message, '--', relative]]) {
    const outcome = await isolatedExec({ command: 'git', args, cwd: root }, env);
    if (outcome.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${outcome.stderr || outcome.stdout}`);
  }
}

export function policyIn(
  root: string,
  host: Host,
  overrides: Partial<GitPolicySettings> = {},
  extras: {
    readonly cwd?: string;
    readonly generateCommitMessage?: (request: { readonly system: string; readonly user: string }) => Promise<string | null>;
    readonly sessionCommitHashes?: Set<string>;
  } = {},
) {
  const { cwd, ...rest } = extras;
  return createGitPolicy({
    host,
    cwd: cwd ?? root,
    settings: { ...defaultSettings, ...overrides },
    ...rest,
  });
}
