import type * as T from "./types.ts";
export declare const REVIEW_THREADS_QUERY = "\nquery ReviewThreads($owner: String!, $repo: String!, $pr: Int!, $after: String) {\n  repository(owner: $owner, name: $repo) {\n    pullRequest(number: $pr) {\n      reviewThreads(first: 100, after: $after) {\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        nodes {\n          id\n          isResolved\n          comments(first: 10) {\n            nodes {\n              body\n              createdAt\n              path\n              line\n              author { login }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n";
export declare const PR_COMMIT_STATUS_QUERY = "\nquery PrCommitStatuses($owner: String!, $repo: String!, $pr: Int!) {\n  repository(owner: $owner, name: $repo) {\n    pullRequest(number: $pr) {\n      commits(last: 50) {\n        nodes {\n          commit {\n            oid\n            statusCheckRollup {\n              state\n            }\n          }\n        }\n      }\n    }\n  }\n}\n";
export declare const PR_CHECK_ROLLUP_QUERY = "\nquery PrCheckRollup($owner: String!, $repo: String!, $pr: Int!, $after: String) {\n  repository(owner: $owner, name: $repo) {\n    pullRequest(number: $pr) {\n      commits(last: 1) {\n        nodes {\n          commit {\n            statusCheckRollup {\n              contexts(first: 100, after: $after) {\n                pageInfo {\n                  hasNextPage\n                  endCursor\n                }\n                nodes {\n                  __typename\n                  ... on CheckRun {\n                    name\n                    status\n                    conclusion\n                    detailsUrl\n                  }\n                  ... on StatusContext {\n                    context\n                    state\n                    targetUrl\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n}\n";
export declare class WatcherQueryError extends Error {
    readonly failure: T.QueryFailure;
    constructor(failure: T.QueryFailure);
}
export declare class ChecksUnavailable extends WatcherQueryError {
    constructor(detail: string);
}
export declare function parseFastCheck(value: unknown): T.Check;
export declare function mapRollupNode(value: unknown): T.Check | null;
export declare function parseReviewThreadPage(value: unknown): T.ReviewThreadPage;
export declare function buildReviewThreads(threads: readonly T.RawReviewThread[]): readonly T.ReviewThread[];
export declare function parsePullRequest(value: unknown, context: T.PrContext): T.PullRequestFacts;
export declare class GhGitHubReader implements T.GitHubReader {
    originRepo(): Promise<T.Repository | null>;
    currentPr(pr: T.PrNumber | null): Promise<T.PrContext>;
    pullRequest(context: T.PrContext): Promise<T.PullRequestFacts>;
    openPullRequests(repository: T.Repository): Promise<readonly T.OpenPullRequest[]>;
    checksFastPath(context: T.PrContext): Promise<T.ChecksFastPath>;
    checkRollupPage(context: T.PrContext, after: string | null): Promise<T.RollupPage>;
    reviewThreadPage(context: T.PrContext, after: string | null): Promise<T.ReviewThreadPage>;
    commitRollups(context: T.PrContext): Promise<readonly T.CommitRollup[]>;
}
export declare function resolveChecks(reader: T.GitHubReader, context: T.PrContext): Promise<T.CheckRead>;
export declare function resolveReviewThreads(reader: T.GitHubReader, context: T.PrContext): Promise<readonly T.ReviewThread[]>;
export declare function resolveContext(args: {
    readonly reader: T.GitHubReader;
    readonly owner: string | null;
    readonly repo: string | null;
    readonly pr: T.PrNumber | null;
}): Promise<T.PrContext>;
export declare function orderStack(context: T.PrContext, open: readonly T.OpenPullRequest[]): T.NonEmpty<T.PrContext>;
export declare function discoverStack(reader: T.GitHubReader, context: T.PrContext): Promise<T.NonEmpty<T.PrContext>>;
