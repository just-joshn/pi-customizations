// The parent's side of the repository for a repro run: what the worker left in its worktree and on the forge, and the one
// way a pull request comes to exist. Upstream opens only draft pull requests and never merges or deploys (vendor
// reproduce SKILL.md:291, `repository.draft_only: true`), and starts no fix before the rejection window closes (SKILL.md:216).
//
// A repro worker runs as the operator in a worktree, so it holds the operator's `gh` and git credentials and no tool
// boundary can take them away: the same-uid limit the contract states. Prevention is therefore by construction, and
// detection is the backstop for a worker that goes around it. By construction the worker is told to commit on its run
// branch and describe the pull request, and the parent pushes that branch and opens the pull request itself, always with
// `--draft`, so the sanctioned path cannot produce a ready-for-review pull request. For a worker that opens one itself
// anyway, the parent finds every pull request on the branches the run owns and converts any that is not a draft before it
// reports, and keeps looking until the worker is shut down.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadAssignment } from '../run-files.ts';
import type { GhExec } from './tracker-github.ts';
import { workerDir } from './dispatch.ts';
import { type RunId, WORKER_ID } from './model.ts';

export type Git = (cwd: string, args: string[]) => Promise<string>;

export const nodeGit: Git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => (error === null ? resolve(stdout) : reject(new Error(`git ${args.slice(0, 2).join(' ')} failed: ${stderr.trim() || error.message}`))));
  });

/** Where a fix is proposed: the `repository.url` repository and its default branch. */
export interface ForgeTarget {
  repo: string;
  baseBranch: string;
}

const GITHUB_REMOTE = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i;

/** `owner/name` of a github.com repository url, in any form git accepts, or undefined for any other host. */
export const githubRepoOf = (url: string): string | undefined => {
  const found = GITHUB_REMOTE.exec(url.trim());
  return found === null ? undefined : `${found[1]}/${found[2]}`.toLowerCase();
};

export const runBranchOf = (runId: RunId) => `pstack-run/${runId}/${WORKER_ID}`;
export const worktreeOf = (projectRoot: string, runId: RunId) => join(workerDir(projectRoot, runId), 'worktree');

export interface PullRequest {
  number: number;
  url: string;
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  body: string;
}

const FIELDS = 'number,url,isDraft,state,body';
const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d{0,9}$/;
/** The line the parent writes at the end of every pull request body it opens. */
export const markerOf = (id: string) => `<!-- pstack-action:${id} -->`;

function parsePulls(output: string): PullRequest[] {
  const parsed: unknown = JSON.parse(output.trim() === '' ? '[]' : output);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((raw: Record<string, unknown>) =>
    typeof raw?.['number'] === 'number' && typeof raw['url'] === 'string' ? [{ number: raw['number'], url: raw['url'], isDraft: raw['isDraft'] === true, state: raw['state'] === 'MERGED' ? ('MERGED' as const) : raw['state'] === 'CLOSED' ? ('CLOSED' as const) : ('OPEN' as const), body: typeof raw['body'] === 'string' ? raw['body'] : '' }] : [],
  );
}

/** What the worker has done in its worktree, from git alone. */
export interface RunState {
  /** Commits on the run branch that are not in the input commit. */
  ahead: number;
  /** Commits the worktree's own HEAD reflog records, on any branch: a worker that committed elsewhere left them there. */
  committed: number;
}

export interface Forge {
  /** The repository pull requests are opened in, or undefined when `repository.url` is not a github.com repository. */
  target: ForgeTarget | undefined;
  /** What the worker has committed. Local git only. */
  state(projectRoot: string, runId: RunId): Promise<RunState>;
  /** Whether the run branch exists on the remote. */
  pushed(projectRoot: string, runId: RunId): Promise<boolean>;
  /** Every pull request, open or not, whose head is the run branch. */
  pullRequests(runId: RunId): Promise<PullRequest[]>;
  /** Makes `pr` a draft when it is an open pull request that is not, and says whether it had to. Throws when it cannot be made one. */
  ensureDraft(pr: PullRequest): Promise<{ pr: PullRequest; converted: boolean }>;
  close(pr: PullRequest, comment: string): Promise<void>;
  /** Pushes the run branch and opens its draft pull request, or finds the one a crash left. Never a ready-for-review pull request. */
  openDraft(request: { projectRoot: string; runId: RunId; actionId: string; title: string; body: string }): Promise<{ pr: PullRequest; reconciled: boolean; converted: boolean }>;
}

export function createForge(options: { git: Git; gh: GhExec; target: ForgeTarget | undefined }): Forge {
  const { git, gh } = options;
  const reach = (): ForgeTarget => {
    if (options.target === undefined) throw new Error('repository.url is not a github.com repository, so the parent cannot reach its pull requests');
    return options.target;
  };
  const view = async (number: number) => parsePulls(await gh(['pr', 'view', String(number), '--repo', reach().repo, '--json', FIELDS]))[0];
  const inputCommitOf = (projectRoot: string, runId: RunId) => {
    const { workspace } = loadAssignment(join(workerDir(projectRoot, runId), 'assignment.json')).assignment;
    if (workspace.mode !== 'worktree') throw new Error('the repro worker has no worktree');
    return workspace.inputCommit;
  };
  const ensureDraft: Forge['ensureDraft'] = async (pr) => {
    if (pr.state !== 'OPEN' || pr.isDraft) return { pr, converted: false };
    await gh(['pr', 'ready', String(pr.number), '--repo', reach().repo, '--undo']);
    const after = await view(pr.number);
    if (after === undefined || !after.isDraft) throw new Error(`pull request ${pr.url} is still ready for review after the conversion to a draft`);
    return { pr: after, converted: true };
  };
  const pullRequests: Forge['pullRequests'] = async (runId) => parsePulls(await gh(['pr', 'list', '--repo', reach().repo, '--head', runBranchOf(runId), '--state', 'all', '--limit', '20', '--json', FIELDS]));
  return {
    target: options.target,
    async state(projectRoot, runId) {
      const cwd = worktreeOf(projectRoot, runId);
      const ahead = Number((await git(cwd, ['rev-list', '--count', `${inputCommitOf(projectRoot, runId)}..refs/heads/${runBranchOf(runId)}`]).catch(() => '0')).trim()) || 0;
      const committed = (await git(cwd, ['reflog', 'show', '--format=%gs', 'HEAD']).catch(() => '')).split('\n').filter((line) => /^commit/.test(line)).length;
      return { ahead, committed };
    },
    async pushed(projectRoot, runId) {
      if (!existsSync(worktreeOf(projectRoot, runId))) return false;
      return (await git(worktreeOf(projectRoot, runId), ['ls-remote', '--heads', 'origin', `refs/heads/${runBranchOf(runId)}`])).trim() !== '';
    },
    pullRequests,
    ensureDraft,
    async close(pr, comment) {
      if (pr.state === 'OPEN') await gh(['pr', 'close', String(pr.number), '--repo', reach().repo, '--comment', comment]);
    },
    async openDraft({ projectRoot, runId, actionId, title, body }) {
      const { repo, baseBranch } = reach();
      const cwd = worktreeOf(projectRoot, runId);
      const head = runBranchOf(runId);
      // The push goes only to the repository the pull request is for.
      const origin = githubRepoOf((await git(cwd, ['config', '--get', 'remote.origin.url'])).trim());
      if (origin !== repo.toLowerCase()) throw new Error(`the worktree's origin is not ${repo}, so nothing was pushed`);
      const known = await pullRequests(runId);
      const merged = known.find((pr) => pr.state === 'MERGED');
      if (merged !== undefined) throw new Error(`pull request ${merged.url} for the run branch is already merged`);
      const open = known.find((pr) => pr.state === 'OPEN');
      if (open !== undefined) return { ...(await ensureDraft(open)), reconciled: true };
      await git(cwd, ['push', 'origin', `refs/heads/${head}:refs/heads/${head}`]);
      const created = (await gh(['pr', 'create', '--repo', repo, '--draft', '--base', baseBranch, '--head', head, '--title', title, '--body', `${body.trimEnd()}\n\n${markerOf(actionId)}`])).trim().split('\n').at(-1) ?? '';
      if (!PR_URL.test(created)) throw new Error('gh pr create did not answer with a pull request url');
      const landed = (await pullRequests(runId)).find((pr) => pr.url === created);
      if (landed === undefined) throw new Error(`the pull request ${created} is not on the run branch after it was opened`);
      return { ...(await ensureDraft(landed)), reconciled: false };
    },
  };
}
