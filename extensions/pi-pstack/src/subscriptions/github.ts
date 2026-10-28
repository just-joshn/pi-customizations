import { execFile } from 'node:child_process';

export type GithubTarget = { scope: 'pr'; prUrl: string } | { scope: 'repo'; repo: string } | { scope: 'author'; author: string; repo: string };

/** Runs `gh` with these arguments and resolves to stdout; rejects when gh fails. */
export type GhRunner = (args: readonly string[]) => Promise<string>;

export const PR_FIELDS = 'state,headRefOid,mergeable,reviewDecision,reviews,comments,statusCheckRollup,url,number,title';
const GH_TIMEOUT_MS = 30_000;

export const defaultGhRunner: GhRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile('gh', [...args], { timeout: GH_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(new Error(String(stderr).trim() || error.message));
    });
  });

export interface PrSnapshot {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefOid: string;
  mergeable: string;
  reviewDecision: string;
  /** Review key to "author: STATE". */
  reviews: Record<string, string>;
  /** Comment key to author. */
  comments: Record<string, string>;
  /** Check name to its conclusion (lowercase), or "pending" while it runs. */
  checks: Record<string, string>;
}

type Raw = Record<string, unknown>;
const str = (input: unknown) => (typeof input === 'string' ? input : '');
const login = (item: Raw) => str((item['author'] as Raw | undefined)?.['login']) || 'unknown';
const list = (input: unknown): Raw[] => (Array.isArray(input) ? input.filter((item): item is Raw => typeof item === 'object' && item !== null) : []);

export function snapshotOf(raw: Raw): PrSnapshot {
  const reviews: Record<string, string> = {};
  for (const review of list(raw['reviews'])) reviews[str(review['id']) || `${login(review)}@${str(review['submittedAt'])}`] = `${login(review)}: ${str(review['state'])}`;
  const comments: Record<string, string> = {};
  for (const comment of list(raw['comments'])) comments[str(comment['id']) || `${login(comment)}@${str(comment['createdAt'])}`] = login(comment);
  const checks: Record<string, string> = {};
  for (const check of list(raw['statusCheckRollup'])) {
    const name = str(check['name']) || str(check['context']);
    if (name === '') continue;
    // A CheckRun has status and conclusion; a StatusContext has state.
    const status = str(check['status']);
    const result = 'state' in check && !('status' in check) ? str(check['state']) : status === 'COMPLETED' ? str(check['conclusion']) : 'PENDING';
    checks[name] = result === 'EXPECTED' ? 'pending' : result.toLowerCase();
  }
  return {
    number: typeof raw['number'] === 'number' ? raw['number'] : 0,
    title: str(raw['title']),
    url: str(raw['url']),
    state: str(raw['state']),
    headRefOid: str(raw['headRefOid']),
    mergeable: str(raw['mergeable']),
    reviewDecision: str(raw['reviewDecision']),
    reviews,
    comments,
    checks,
  };
}

const short = (sha: string) => sha.slice(0, 7) || '(none)';
const shown = (text: string) => text || 'NONE';

/** What changed from one snapshot of a PR to the next, as phrases for the wake message. */
export function diffPr(before: PrSnapshot, after: PrSnapshot): string[] {
  const changes: string[] = [];
  if (before.state !== after.state) {
    changes.push(after.state === 'MERGED' ? 'merged' : after.state === 'CLOSED' ? 'closed' : after.state === 'OPEN' ? 'reopened' : `state ${before.state}→${after.state}`);
  }
  if (before.headRefOid !== after.headRefOid) changes.push(`head moved ${short(before.headRefOid)}→${short(after.headRefOid)}`);
  // UNKNOWN is GitHub still computing mergeability, not a change worth a wake.
  if (before.mergeable !== after.mergeable && after.mergeable !== 'UNKNOWN') changes.push(`mergeability ${shown(before.mergeable)}→${shown(after.mergeable)}`);
  if (before.reviewDecision !== after.reviewDecision) changes.push(`review decision ${shown(before.reviewDecision)}→${shown(after.reviewDecision)}`);
  for (const [key, review] of Object.entries(after.reviews)) if (!(key in before.reviews)) changes.push(`new review by ${review}`);
  for (const [key, author] of Object.entries(after.comments)) if (!(key in before.comments)) changes.push(`new comment by ${author}`);
  // A check wakes when it concludes, or its conclusion changes; queued→in_progress churn does not.
  for (const [name, result] of Object.entries(after.checks)) if (result !== 'pending' && before.checks[name] !== result) changes.push(`check \`${name}\` ${result}`);
  return changes;
}

const TITLE_LIMIT = 200;
const truncateTitle = (title: string) => (title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title);
/** JSON whose `<` is escaped, so a title or check name cannot close the surrounding tag. */
const tagSafeJson = (value: unknown) => JSON.stringify(value, null, 2).replace(/</g, '\\u003c');

function githubEventBlock(pr: Pick<PrSnapshot, 'number' | 'title' | 'url'>, changes: string[]): string {
  return ['<github_event>', tagSafeJson({ number: pr.number, title: truncateTitle(pr.title), url: pr.url, changes }), '</github_event>'].join('\n');
}

export function targetText(target: GithubTarget): string {
  return target.scope === 'pr' ? target.prUrl : target.scope === 'repo' ? `repo ${target.repo}` : `${target.repo} PRs by ${target.author}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('gh returned output that is not JSON.');
  }
}

/** The PRs this target watches, keyed by number. */
export async function fetchPrs(gh: GhRunner, target: GithubTarget): Promise<Map<number, PrSnapshot>> {
  if (target.scope === 'pr') {
    const raw = parseJson(await gh(['pr', 'view', target.prUrl, '--json', PR_FIELDS]));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('gh pr view returned no PR.');
    const pr = snapshotOf(raw as Raw);
    return new Map([[pr.number, pr]]);
  }
  const args = ['pr', 'list', '--repo', target.repo, ...(target.scope === 'author' ? ['--author', target.author] : []), '--state', 'open', '--limit', '100', '--json', PR_FIELDS];
  const raw = parseJson(await gh(args));
  if (!Array.isArray(raw)) throw new Error('gh pr list returned no list.');
  return new Map(list(raw).map((item) => snapshotOf(item)).map((pr) => [pr.number, pr]));
}

/**
 * Change blocks for one poll: per-PR diffs, PRs that appeared (repo and author scopes), and PRs that left the open
 * list, whose final state comes from `gh pr view`.
 */
export async function pollChanges(gh: GhRunner, target: GithubTarget, before: ReadonlyMap<number, PrSnapshot>, after: Map<number, PrSnapshot>): Promise<string[]> {
  const blocks: string[] = [];
  const block = (pr: PrSnapshot, changes: string[]) => {
    if (changes.length > 0) blocks.push(githubEventBlock(pr, changes));
  };
  for (const [number, pr] of after) {
    const previous = before.get(number);
    block(pr, previous === undefined ? ['opened'] : diffPr(previous, pr));
  }
  if (target.scope !== 'pr') {
    for (const [number, pr] of before) {
      if (after.has(number)) continue;
      const raw = parseJson(await gh(['pr', 'view', String(number), '--repo', target.repo, '--json', PR_FIELDS]));
      const final = snapshotOf(raw as Raw);
      block(final, diffPr(pr, final).length > 0 ? diffPr(pr, final) : ['left the open list']);
    }
  }
  return blocks;
}
