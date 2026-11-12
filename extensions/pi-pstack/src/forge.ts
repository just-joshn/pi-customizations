import {
  buildReviewThreads,
  parseFastCheck,
  parsePullRequest,
  parseReviewThreadPage,
  REVIEW_THREADS_QUERY,
} from '../skills/poteto-mode/scripts/watch-pr/github.ts';
import { parsePrNumber } from '../skills/poteto-mode/scripts/watch-pr/types.ts';
import type * as Watch from '../skills/poteto-mode/scripts/watch-pr/types.ts';

export type PullRequestSnapshot = Watch.PullRequestFacts & { readonly url: string };
export type CheckSnapshot = Watch.Check;
export type ReviewThread = Watch.ReviewThread;
export interface CreatePullRequest {
  title: string;
  body: string;
  base: string;
  head: string;
}
export interface ReplyToThread { threadId: string; body: string }
export interface VerificationVerdict {
  ref: string;
  headSha: string;
  verdict: 'PASS' | 'PASS+NOTES' | 'FAIL';
  author: string;
  verifier: string;
}
export interface OperatorAuthorization {
  operator: string;
  action: 'merge' | 'land' | 'ship' | 'merge-when-ready';
  refs: readonly string[];
  recordedAt: string;
}
export interface MergeRequest {
  ref: string;
  headSha: string;
  verdict: VerificationVerdict;
  authorization: OperatorAuthorization;
}
export interface ForgeAdapter {
  getPullRequest(ref: string): Promise<PullRequestSnapshot>;
  getChecks(ref: string): Promise<CheckSnapshot[]>;
  getReviewThreads(ref: string): Promise<ReviewThread[]>;
  createPullRequest(input: CreatePullRequest): Promise<string>;
  replyToThread(input: ReplyToThread): Promise<void>;
  mergePullRequest(input: MergeRequest): Promise<void>;
}
export type ForgeOperation = keyof ForgeAdapter;
export type ForgeBackend = 'native' | 'origin' | 'github';
export interface Forge extends ForgeAdapter {
  readonly backend: ForgeBackend;
  readonly capabilities: ReadonlySet<ForgeOperation>;
}
export type Exec = (
  argv: readonly string[], options?: { stdin?: string },
) => Promise<{ code: number; stdout: string; stderr: string }>;
export class UnsupportedForgeOperation extends Error {
  constructor(backend: ForgeBackend, operation: ForgeOperation, reason: string) {
    super(`${backend} does not support ${operation}: ${reason}`);
    this.name = 'UnsupportedForgeOperation';
  }
}
const operations: readonly ForgeOperation[] = [
  'getPullRequest', 'getChecks', 'getReviewThreads', 'createPullRequest',
  'replyToThread', 'mergePullRequest',
];

export function unsupportedForge(backend: ForgeBackend, reason: string): Forge {
  const unsupported = (operation: ForgeOperation): never => {
    throw new UnsupportedForgeOperation(backend, operation, reason);
  };
  return {
    backend, capabilities: new Set(),
    async getPullRequest() { return unsupported('getPullRequest'); },
    async getChecks() { return unsupported('getChecks'); },
    async getReviewThreads() { return unsupported('getReviewThreads'); },
    async createPullRequest() { return unsupported('createPullRequest'); },
    async replyToThread() { return unsupported('replyToThread'); },
    async mergePullRequest() { return unsupported('mergePullRequest'); },
  };
}

export function githubForge(exec: Exec): Forge {
  async function run(argv: string[], stdin?: string, codes = [0]): Promise<string> {
    const result = await exec(['gh', ...argv], stdin === undefined ? undefined : { stdin });
    if (!codes.includes(result.code)) throw new Error(`gh failed (${result.code}): ${result.stderr}`);
    return result.stdout;
  }
  async function json(argv: string[], stdin?: string, codes?: number[]): Promise<unknown> {
    return JSON.parse(await run(argv, stdin, codes));
  }
  async function getPullRequest(ref: string): Promise<PullRequestSnapshot> {
    const raw = await json(['pr', 'view', ref, '--json',
      'url,number,mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,state,mergedAt,isDraft']);
    if (typeof raw !== 'object' || raw === null || !('url' in raw) || typeof raw.url !== 'string') {
      throw new Error('Missing pull request URL');
    }
    const url = new URL(raw.url);
    const [owner, repo, pull, number] = url.pathname.slice(1).split('/');
    if (!owner || !repo || pull !== 'pull') throw new Error('Invalid pull request URL');
    return { ...parsePullRequest(raw, { owner, repo, number: parsePrNumber(Number(number)) }), url: raw.url };
  }
  return {
    backend: 'github', capabilities: new Set(operations), getPullRequest,
    async getChecks(ref) {
      const raw = await json(['pr', 'checks', ref, '--json', 'name,state,bucket,description,link,workflow'], undefined, [0, 1, 8]);
      if (!Array.isArray(raw)) throw new Error('Expected check array');
      return raw.map(parseFastCheck);
    },
    async getReviewThreads(ref) {
      const { context } = await getPullRequest(ref);
      const threads: Watch.RawReviewThread[] = [];
      let cursor: string | null = null;
      do {
        const args = ['api', 'graphql', '-f', `query=${REVIEW_THREADS_QUERY}`,
          '-f', `owner=${context.owner}`, '-f', `repo=${context.repo}`, '-F', `pr=${context.number}`];
        if (cursor !== null) args.push('-f', `after=${cursor}`);
        const page = parseReviewThreadPage(await json(args));
        threads.push(...page.threads);
        if (page.endCursor !== null && page.endCursor === cursor) throw new Error('Repeated review thread cursor');
        cursor = page.endCursor;
      } while (cursor !== null);
      return [...buildReviewThreads(threads)];
    },
    async createPullRequest(input) {
      return (await run(['pr', 'create', '--title', input.title, '--body-file', '-',
        '--base', input.base, '--head', input.head], input.body)).trim();
    },
    async replyToThread(input) {
      await json(['api', 'graphql', '--input', '-'], JSON.stringify({
        query: 'mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $thread, body: $body}) { comment { id } } }',
        variables: { thread: input.threadId, body: input.body },
      }));
    },
    async mergePullRequest(input) {
      if (!mergeAllowed(input)) throw new Error('Merge requires operator authorization and independent verification of the current head');
      await run(['pr', 'merge', input.ref, '--squash', '--match-head-commit', input.headSha]);
    },
  };
}

export interface ForgeEnvironment {
  exec: Exec;
  native?: Forge;
  origin?: Forge;
  originCliAvailable?: boolean;
  persistedChoice?: ForgeBackend;
  persistChoice(choice: ForgeBackend): Promise<void>;
}
export async function resolveForge(env: ForgeEnvironment): Promise<Forge> {
  const choice = env.persistedChoice ?? (env.native ? 'native' : env.origin ? 'origin' : 'github');
  const forge = choice === 'native'
    ? env.native ?? unsupportedForge('native', 'the selected native integration is unavailable')
    : choice === 'origin'
      ? env.origin ?? unsupportedForge('origin', env.originCliAvailable
        ? 'no supported Origin adapter was supplied' : 'Origin CLI is absent')
      : githubForge(env.exec);
  if (env.persistedChoice === undefined) await env.persistChoice(choice);
  return forge;
}

export type BabysitMode = 'check' | 'threads-only' | 'drive' | 'background';
export function babysitMode(input: {
  request?: string;
  mode?: BabysitMode;
  small?: boolean;
  docsOnly?: boolean;
  planExecuting?: boolean;
}): BabysitMode {
  const request = input.request?.toLowerCase() ?? '';
  const mode = input.mode ?? (input.planExecuting || /\bbackground\b/.test(request) ? 'background'
    : /address .*comments|threads.only/.test(request) ? 'threads-only'
      : /check on|is it green/.test(request) ? 'check' : 'drive');
  return mode === 'drive' && (input.small || input.docsOnly) ? 'check' : mode;
}
export interface StackPullRequest { ref: string; headSha: string; merged: boolean }
function verified(pr: { ref: string; headSha: string }, verdict: VerificationVerdict): boolean {
  return verdict.ref === pr.ref && verdict.headSha === pr.headSha
    && verdict.verdict !== 'FAIL' && verdict.verifier.length > 0 && verdict.author.length > 0
    && verdict.verifier !== verdict.author;
}
export function shippablePrefix<T extends StackPullRequest>(
  stack: readonly T[], verdicts: readonly VerificationVerdict[],
): T[] {
  const prefix: T[] = [];
  for (const pr of stack) {
    if (pr.merged) continue;
    const verdict = verdicts.findLast((item) => item.ref === pr.ref);
    if (!verdict || !verified(pr, verdict)) break;
    prefix.push(pr);
  }
  return prefix;
}
export function mergeAllowed(input: {
  ref: string;
  headSha: string;
  verdict?: VerificationVerdict;
  authorization?: OperatorAuthorization;
}): boolean {
  const authorization = input.authorization;
  return authorization !== undefined && authorization.operator.trim().length > 0
    && Number.isFinite(Date.parse(authorization.recordedAt))
    && ['merge', 'land', 'ship', 'merge-when-ready'].includes(authorization.action)
    && authorization.refs.includes(input.ref)
    && input.verdict !== undefined && verified(input, input.verdict);
}
