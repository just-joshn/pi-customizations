import {
  at,
  list,
  missing,
  optionalString,
  record,
  string,
} from "./github-json.ts";
import type {
  RawReviewThread,
  ReviewComment,
  ReviewThread,
  ReviewThreadPage,
} from "./types.ts";

const BUGBOT_TOKENS = [
  "bugbot",
  "cursor_automation_id",
  "agentic security review",
  "description start",
  "severity",
];
const PASS_KEY_PATTERNS = [
  /RUN_ID:\s*([a-zA-Z0-9_.:-]+)/,
  /CURSOR_AUTOMATION_ID:\s*([a-zA-Z0-9_.:-]+)/,
];

function parseLine(value: unknown): number | null {
  if (value === null) return null;
  return Number.isInteger(value) ? Number(value) : missing("review comment.line", value);
}
function parseComment(value: unknown): ReviewComment {
  const object = record(value, "review comment");
  const author =
    object.author === null
      ? null
      : record(object.author, "review comment.author");
  return {
    authorLogin:
      author === null
        ? null
        : optionalString(author.login, "review comment.author.login"),
    body: string(object.body, "review comment.body"),
    path: optionalString(object.path, "review comment.path"),
    line: parseLine(object.line),
    createdAt: string(object.createdAt, "review comment.createdAt"),
  };
}
function isBugbot(comment: ReviewComment | null): boolean {
  if (comment === null) return false;
  const author = (comment.authorLogin ?? "").toLowerCase();
  const body = comment.body.toLowerCase();
  return (
    author.includes("bugbot") ||
    (author === "cursor" && BUGBOT_TOKENS.some((token) => body.includes(token)))
  );
}
function passKey(comment: ReviewComment | null): string | null {
  if (comment === null) return null;
  const matches = PASS_KEY_PATTERNS.map((pattern) => pattern.exec(comment.body));
  return matches.find((match) => match?.[1])?.[1] ?? null;
}
function parseThread(node: unknown): RawReviewThread {
  const thread = record(node, "review thread");
  if (typeof thread.isResolved !== "boolean")
    missing("review thread.isResolved", thread.isResolved);
  const comments = list(
    at(thread, ["comments", "nodes"]),
    "review thread.comments.nodes"
  );
  return {
    id: string(thread.id, "review thread.id"),
    firstComment: comments.length === 0 ? null : parseComment(comments[0]),
    resolved: thread.isResolved,
  };
}
export function parseReviewThreadPage(value: unknown): ReviewThreadPage {
  const reviewThreads = record(
    at(value, ["data", "repository", "pullRequest", "reviewThreads"]),
    "reviewThreads"
  );
  const nodes = list(reviewThreads.nodes, "reviewThreads.nodes");
  const threads = nodes.map(parseThread);
  const page = record(reviewThreads.pageInfo, "reviewThreads.pageInfo");
  if (typeof page.hasNextPage !== "boolean")
    missing("reviewThreads.pageInfo.hasNextPage", page.hasNextPage);
  const cursor = optionalString(
    page.endCursor,
    "reviewThreads.pageInfo.endCursor"
  );
  return { threads, endCursor: page.hasNextPage && cursor ? cursor : null };
}
function countPasses(threads: readonly RawReviewThread[]): number {
  const bugbot = threads.filter((thread) => isBugbot(thread.firstComment));
  const keys = new Set(bugbot.map((thread) => passKey(thread.firstComment)));
  const hasKeyless = keys.delete(null);
  if (keys.size > 0) return keys.size;
  return hasKeyless ? 1 : 0;
}
export function buildReviewThreads(
  threads: readonly RawReviewThread[]
): readonly ReviewThread[] {
  const passes = countPasses(threads);
  return threads
    .filter((thread) => !thread.resolved)
    .map(({ id, firstComment }) => ({
      id,
      firstComment,
      isBugbot: isBugbot(firstComment),
      bugbotReviewPasses: passes,
    }));
}
