// GitHub Issues as a Benny tracker, through the `gh` CLI. Every call is an argv array, never a shell string.
// The action id travels in an HTML comment in the same mutation that writes the issue body or comment, and
// `searchByMarker` finds it by listing recent issues and comments instead of the search index, which lags writes.
import { execFile } from 'node:child_process';

import { type TrackerAction, untrustedText } from './model.ts';
import type { TrackerDestination } from './outbox.ts';

/** Runs `gh <args>` and returns stdout; rejects when gh exits nonzero. */
export type GhExec = (args: string[]) => Promise<string>;

export const nodeGh: GhExec = (args) =>
  new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => (error === null ? resolve(stdout) : reject(new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${stderr.trim() || error.message}`))));
  });

export interface TrackerIssue {
  id: string;
  state: 'open' | 'closed';
  title: string;
}

/** What the trusted parent reads to judge eligibility. Workers never hold one. */
export interface TrackerReader {
  findBySource(sourceUrl: string): Promise<TrackerIssue[]>;
  findOpenByTitle(title: string): Promise<TrackerIssue[]>;
  read(id: string): Promise<TrackerIssue | undefined>;
}

export const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;
const ISSUE_ID = /^[1-9][0-9]{0,9}$/;
const MARKER_PREFIX = 'pstack-action:';
export const markerComment = (id: string) => `<!-- ${MARKER_PREFIX}${id} -->`;
const footerOf = (sourceUrl: string, marker: string) => `Source: ${sourceUrl}\n\n${marker}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lines = (output: string) => output.split('\n').filter((line) => line.trim() !== '');

interface RawIssue {
  number: number;
  state: string;
  title: string;
  body: string | null;
}
interface RawComment {
  issue_url: string;
  body: string | null;
}

export interface GithubTracker extends TrackerDestination, TrackerReader {
  /** Closes an issue this automation created. The compensation action the pack's triage rules name. */
  close(id: string): Promise<void>;
  /** The repository answers for this credential. */
  reachable(): Promise<boolean>;
}

export function githubTracker(options: { exec: GhExec; repo: string; now?: () => Date; lookbackDays?: number }): GithubTracker {
  const { exec, repo } = options;
  if (!REPO.test(repo)) throw new Error(`invalid GitHub repository ${repo}; expected owner/name`);
  const now = options.now ?? (() => new Date());
  const lookbackMs = (options.lookbackDays ?? 90) * 86_400_000;
  const issueId = (id: string) => {
    if (!ISSUE_ID.test(id)) throw new Error(`invalid GitHub issue number ${id}`);
    return id;
  };
  const since = () => new Date(now().getTime() - lookbackMs).toISOString();

  const issues = async (): Promise<RawIssue[]> =>
    lines(await exec(['api', '--paginate', '-X', 'GET', `repos/${repo}/issues`, '-f', 'state=all', '-f', `since=${since()}`, '-f', 'per_page=100', '--jq', '.[] | select(.pull_request == null) | {number, state, title, body}'])).map((line) => JSON.parse(line) as RawIssue);
  const comments = async (): Promise<RawComment[]> =>
    lines(await exec(['api', '--paginate', '-X', 'GET', `repos/${repo}/issues/comments`, '-f', `since=${since()}`, '-f', 'per_page=100', '--jq', '.[] | {issue_url, body}'])).map((line) => JSON.parse(line) as RawComment);
  const issueOf = (raw: RawIssue): TrackerIssue => ({ id: String(raw.number), state: raw.state === 'open' ? 'open' : 'closed', title: raw.title });

  /** Issue ids whose body or comments satisfy `matches`. */
  const containing = async (matches: (text: string) => boolean): Promise<string[]> => {
    const found = new Set<string>();
    for (const issue of await issues()) if (issue.body !== null && matches(issue.body)) found.add(String(issue.number));
    for (const comment of await comments()) if (comment.body !== null && matches(comment.body)) found.add(comment.issue_url.split('/').at(-1) as string);
    return [...found];
  };
  const number = (output: string) => ({ id: issueId(output.trim()) });
  const footer = (action: TrackerAction) => `${untrustedText(action.body).trimEnd()}\n\n${footerOf(action.sourceUrl, markerComment(action.id))}`;

  return {
    async searchByMarker(marker) {
      const needle = markerComment(marker);
      return (await containing((text) => text.includes(needle))).map((id) => ({ id }));
    },
    async create(action) {
      if (action.title === undefined) throw new Error('GitHub create needs a title');
      return number(await exec(['api', '-X', 'POST', `repos/${repo}/issues`, '-f', `title=${action.title}`, '-f', `body=${footer(action)}`, ...(action.labels ?? []).flatMap((label) => ['-f', `labels[]=${label}`]), '--jq', '.number']));
    },
    async update(action) {
      const id = issueId(action.targetId ?? '');
      const current = (await exec(['api', `repos/${repo}/issues/${id}`, '--jq', '.body // ""'])).replace(/\n$/, '');
      return number(await exec(['api', '-X', 'PATCH', `repos/${repo}/issues/${id}`, '-f', `body=${current}\n\n---\n${footer(action)}`, '--jq', '.number']));
    },
    async comment(action) {
      const id = issueId(action.targetId ?? '');
      await exec(['api', '-X', 'POST', `repos/${repo}/issues/${id}/comments`, '-f', `body=${footer(action)}`, '--jq', '.id']);
      return { id };
    },
    async findBySource(sourceUrl) {
      const written = new RegExp(`${escapeRegExp(`Source: ${sourceUrl}`)}\\n\\n<!-- ${MARKER_PREFIX}act-[0-9a-f]{16} -->`);
      const ids = new Set(await containing((text) => written.test(text)));
      return (await issues()).filter((issue) => ids.has(String(issue.number))).map(issueOf);
    },
    async findOpenByTitle(title) {
      const wanted = title.trim().toLowerCase();
      return (await issues()).filter((issue) => issue.state === 'open' && issue.title.trim().toLowerCase() === wanted).map(issueOf);
    },
    async read(id) {
      if (!ISSUE_ID.test(id)) return undefined;
      const output = await exec(['api', `repos/${repo}/issues/${id}`, '--jq', '{number, state, title, pull_request: (.pull_request != null)}']).catch(() => undefined);
      if (output === undefined) return undefined;
      const raw = JSON.parse(output) as RawIssue & { pull_request: boolean };
      return raw.pull_request ? undefined : issueOf(raw);
    },
    async close(id) {
      await exec(['api', '-X', 'PATCH', `repos/${repo}/issues/${issueId(id)}`, '-f', 'state=closed', '--jq', '.number']);
    },
    async reachable() {
      return (await exec(['api', `repos/${repo}`, '--jq', '.full_name']).catch(() => '')).trim() === repo;
    },
  };
}
