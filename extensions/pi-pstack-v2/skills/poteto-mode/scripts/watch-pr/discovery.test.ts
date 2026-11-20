import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { GH_PR, GH_TARGET, NO_RETRIES, exit, json, useGhCli } from "./gh.test-helper.ts";
import { get, parseLines, pluck } from "./output.test-helper.ts";

const cli = useGhCli();
const EXIT_STATUS_QUERY = 7;
const GIT_FAILURE_EXIT = 128;
const GITHUB = "https://github.com";
const NUMBER_URL_COMMAND = "gh pr view 42 --json number,url";
const ORIGIN_COMMAND = "git remote get-url origin";
const prFlag = ["--pr", String(GH_PR)];
const originReply = (stdout: string) => ({ origin: () => ({ stdout }) });
const viewedRepo = (commands: readonly string[]) =>
  commands.find((command) => command.startsWith("gh pr view 42 --repo"))?.split(" ")[5];

describe("repository discovery", () => {
  test("explicit flags need no git or gh lookup", async () => {
    const run = await cli.run(GH_TARGET);
    expect(run.commands.some((command) => command.startsWith("git"))).toBe(false);
    expect(run.commands.some((command) => command.includes("number,url"))).toBe(false);
  });

  test("an explicit PR number takes the repository from git's origin", async () => {
    const run = await cli.run(prFlag, originReply(`${GITHUB}/acme/widgets`));
    expect(run.commands[0]).toBe(ORIGIN_COMMAND);
    expect(viewedRepo(run.commands)).toBe("acme/widgets");
  });

  test("no PR flags infers owner, repo and number from the current branch's PR", async () => {
    const url = `${GITHUB}/acme/widgets/pull/7`;
    const run = await cli.run([], { currentPr: () => json({ number: 7, url }) });
    expect(run.commands[0]).toBe("gh pr view --json number,url");
    expect(run.commands[1]).toContain("gh pr view 7 --repo acme/widgets");
    expect(get(run.lines[0], "scope.pr.context")).toEqual({ owner: "acme", repo: "widgets", number: 7 });
  });
});

const GOOD_REMOTES: readonly (readonly [string, string])[] = [
  ["an scp-style remote", "git@github.com:acme/widgets.git\n"],
  ["an ssh:// remote", "ssh://git@github.com/acme/widgets.git"],
  ["an https remote", `${GITHUB}/acme/widgets`],
  ["an https remote ending in .git", `${GITHUB}/acme/widgets.git\n`],
];
const GITLAB_REMOTE = "https://gitlab.com/acme/widgets.git";
const PORT_REMOTE = "https://github.com:8443/acme/widgets";
const CREDENTIAL_REMOTE = "https://user:pass@github.com/acme/widgets";
const PLAIN_HTTP_REMOTE = "http://github.com/acme/widgets";
const BAD_REMOTES: readonly (readonly [string, string])[] = [
  ["a non-GitHub host", GITLAB_REMOTE],
  ["text that is not a URL", "not a url"],
  ["a URL with extra path parts", `${GITHUB}/acme/widgets/extra`],
  ["a URL with a port", PORT_REMOTE],
  ["a URL with credentials", CREDENTIAL_REMOTE],
  ["a plain http URL", PLAIN_HTTP_REMOTE],
];

describe("git origin parsing", () => {
  test.each(GOOD_REMOTES)("takes the repository from %s", async (_name, remote) => {
    const run = await cli.run(prFlag, originReply(remote));
    expect(viewedRepo(run.commands)).toBe("acme/widgets");
  });

  test.each(BAD_REMOTES)("asks gh for the PR when origin is %s", async (_name, remote) => {
    const run = await cli.run(prFlag, originReply(remote));
    expect(run.commands.slice(0, 2)).toEqual([ORIGIN_COMMAND, NUMBER_URL_COMMAND]);
    expect(viewedRepo(run.commands)).toBe("owner/repo");
  });

  test("asks gh for the PR when git has no origin", async () => {
    const run = await cli.run(prFlag, { origin: () => exit(GIT_FAILURE_EXIT, "fatal: no remote") });
    expect(run.commands.slice(0, 2)).toEqual([ORIGIN_COMMAND, NUMBER_URL_COMMAND]);
    expect(run.code).toBe(0);
  });
});

const OTHER_HOST_PR_URL = "https://example.com/acme/widgets/pull/7";
const BAD_PR_URLS: readonly (readonly [string, string])[] = [
  ["a non-GitHub URL", OTHER_HOST_PR_URL],
  ["an issue URL", `${GITHUB}/acme/widgets/issues/7`],
  ["a non-numeric PR number", `${GITHUB}/acme/widgets/pull/seven`],
  ["text that is not a URL", "nonsense"],
];

describe("current PR failures", () => {
  test.each(BAD_PR_URLS)("exit 7 without retrying when gh reports %s", async (_name, url) => {
    const run = await cli.run([], { currentPr: () => json({ number: 7, url }) });
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(run.sleeps).toEqual([]);
    expect(get(run.lines[0], "blocker.failures")).toBe(1);
    expect(get(run.lines[0], "blocker.failure.kind")).toBe("invalid-context-url");
    expect(get(run.lines[0], "blocker.failure.retryable")).toBe(false);
    expect(get(run.lines[0], "blocker.failure.rawValue")).toBe(url);
  });

  test("print as text with --pretty", async () => {
    const run = await cli.run(["--pretty"], { currentPr: () => exit(1, "no pull requests found") });
    expect(run.code).toBe(EXIT_STATUS_QUERY);
    expect(run.stdout.split("\n")).toEqual([
      "BLOCKER: status-query",
      "failures=1",
      "detail=no pull requests found",
      "action=verify current PR context, GitHub authentication, and API availability, then rearm",
      "",
    ]);
  });
});

const LIST_COMMAND =
  "gh pr list --repo owner/repo --state open --limit 300 --json number,headRefName,baseRefName,isCrossRepository";
const BASE_PR = GH_PR - 1;
const UPSTACK_PR = GH_PR + 1;
const stackTarget = [...GH_TARGET, "--stack"];
const row = (number: number, head: string, base: string, isCrossRepository: boolean) => ({
  number,
  headRefName: head,
  baseRefName: base,
  isCrossRepository,
});
const listed = (...rows: readonly unknown[]) => ({ openPullRequests: () => json(rows) });
const stackNumbers = (run: { readonly lines: readonly unknown[] }) =>
  pluck(run.lines.at(-1), "scope.prs", "context.number");

describe("open PR listing for stacks", () => {
  test("requests fork identity and orders the stack bottom to top", async () => {
    const run = await cli.run(stackTarget, listed(
      row(UPSTACK_PR, "upstack", "feature", false),
      row(GH_PR, "feature", "base-feature", false),
      row(BASE_PR, "base-feature", "main", false),
    ));
    expect(run.commands).toContain(LIST_COMMAND);
    expect(stackNumbers(run)).toEqual([BASE_PR, GH_PR, UPSTACK_PR]);
  });

  test("does not use a fork's same-named head as the stack parent", async () => {
    const run = await cli.run(stackTarget, listed(
      row(BASE_PR, "base-feature", "main", true),
      row(GH_PR, "feature", "base-feature", false),
    ));
    expect(stackNumbers(run)).toEqual([GH_PR]);
  });

  test("rejects a listing row that omits isCrossRepository", async () => {
    const incomplete = { number: GH_PR, headRefName: "feature", baseRefName: "main" };
    const run = await cli.run([...stackTarget, ...NO_RETRIES], listed(incomplete));
    expect(get(run.lines[0], "blocker.failure.detail")).toContain("isCrossRepository");
  });

  test("rejects a listing that is not an array", async () => {
    const run = await cli.run([...stackTarget, ...NO_RETRIES], { openPullRequests: () => json({}) });
    expect(get(run.lines[0], "blocker.failure.detail")).toContain("open PRs");
  });
});

const WATCH_PR = join(import.meta.dir, "watch-pr");
const SUBPROCESS_TIMEOUT_MS = 20_000;
const EXECUTABLE_MODE = 0o755;
const PARENT_ENV = z.record(z.string(), z.string().optional());
const FAKE_GH = `#!/bin/sh
case "$*" in
  *"pr list"*) printf '%s' '[{"number":41,"headRefName":"main","baseRefName":"main","isCrossRepository":true},{"number":42,"headRefName":"feature","baseRefName":"main","isCrossRepository":false}]' ;;
  *"pr view"*) printf '%s' '{"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":"APPROVED","headRefOid":"head","headRefName":"feature","baseRefName":"main","state":"OPEN","mergedAt":null,"isDraft":false}' ;;
  *"pr checks"*) printf '%s' '[{"name":"ci","state":"SUCCESS","bucket":"pass"}]' ;;
  *PrCommitStatuses*) printf '%s' '{"data":{"repository":{"pullRequest":{"commits":{"nodes":[{"commit":{"oid":"head","statusCheckRollup":{"state":"SUCCESS"}}}]}}}}}' ;;
  *) printf '%s' '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}' ;;
esac
`;

describe("the watch-pr executable", () => {
  test("terminates and watches one PR when an unrelated fork opens main against main", () => {
    const directory = mkdtempSync(join(tmpdir(), "watch-pr-bin-"));
    try {
      writeFileSync(join(directory, "gh"), FAKE_GH);
      chmodSync(join(directory, "gh"), EXECUTABLE_MODE);
      const env = PARENT_ENV.parse(process.env);
      const path = `${directory}:${env.PATH}`;
      const argv = [WATCH_PR, ...GH_TARGET, "--stack"];
      const child = spawnSync(process.execPath, argv, {
        encoding: "utf8",
        timeout: SUBPROCESS_TIMEOUT_MS,
        env: { ...env, PATH: path },
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(stackNumbers({ lines: parseLines(child.stdout) })).toEqual([GH_PR]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
