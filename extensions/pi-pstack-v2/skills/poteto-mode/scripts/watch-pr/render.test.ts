import { describe, expect, test } from "bun:test";
import {
  failedCheck,
  fakeReader,
  passingCheck,
  pendingCheck,
  reviewThread,
  type FakeReaderOptions,
} from "./fakes.test-helper.ts";
import { runCli, TARGET } from "./harness.test-helper.ts";

const PRETTY_STATUS = [...TARGET, "--status-only", "--pretty"] as const;
const ROW = /^\| \[#1\]\(https:\/\/github\.com\/owner\/repo\/pull\/1\) \| (.*) \| (.*) \| (.*) \|$/;
const OLD_PASSING = [{ oid: "older", state: "SUCCESS" as const }, { oid: "head", state: "PENDING" as const }];
const checks = (...list: ReturnType<typeof passingCheck>[]): FakeReaderOptions["fastPath"] => ({ kind: "checks", checks: list });

/** The CI, review and merge cells of the one status row. */
async function cells(options: FakeReaderOptions): Promise<readonly string[]> {
  const run = await runCli(PRETTY_STATUS, fakeReader(options));
  const match = ROW.exec(run.stdout.split("\n")[2] ?? "");
  if (match === null) throw new Error(`no status row in:\n${run.stdout}`);
  return match.slice(1);
}

type CellCase = readonly [name: string, options: FakeReaderOptions, expected: readonly string[]];
const CI_CASES: readonly CellCase[] = [
  ["passing checks", {}, ["✅", "✅", "✅"]],
  ["pending checks", { fastPath: checks(pendingCheck()) }, ["⏳ 1 pending", "✅", "✅"]],
  ["pending checks after an earlier passing run", { fastPath: checks(pendingCheck()), commitRollups: OLD_PASSING }, ["⏳ 1 pending, was ✅", "✅", "✅"]],
  ["a failing check", { fastPath: checks(failedCheck()) }, ["❌ 1 failed", "✅", "✅"]],
  ["a failing and a pending check", { fastPath: checks(failedCheck(), pendingCheck("b")) }, ["❌ 1 failed, 1 pending", "✅", "✅"]],
  ["a failing check after an earlier passing run", { fastPath: checks(failedCheck()), commitRollups: [{ oid: "older", state: "SUCCESS" }] }, ["❌ 1 failed, was ✅", "✅", "✅"]],
  ["a GitHub refusal behind a clean list", { facts: { mergeStateStatus: "BLOCKED" }, commitRollups: [{ oid: "head", state: "FAILURE" }] }, ["❌ GitHub reports failing checks", "✅", "✅"]],
];

describe("status table CI cell", () => {
  test.each(CI_CASES)("shows %s", async (_name, options, expected) => {
    expect(await cells(options)).toEqual(expected);
  });
});

const REVIEW_CASES: readonly CellCase[] = [
  ["open threads", { threads: [reviewThread("a"), reviewThread("b")] }, ["✅", "📝 2 open", "✅"]],
  ["a running review bot", { fastPath: checks(pendingCheck("Bugbot")) }, ["⏳ 1 pending", "🤖 running", "✅"]],
  ["a running review bot and open threads", { fastPath: checks(pendingCheck("Security Review")), threads: [reviewThread("a")] }, ["⏳ 1 pending", "🤖 running, 1 open", "✅"]],
  ["a running PR review automation", { fastPath: checks(pendingCheck("pr review automation")) }, ["⏳ 1 pending", "🤖 running", "✅"]],
  ["a finished review bot", { fastPath: checks(passingCheck("Bugbot")) }, ["✅", "✅", "✅"]],
];

describe("status table review cell", () => {
  test.each(REVIEW_CASES)("shows %s", async (_name, options, expected) => {
    expect(await cells(options)).toEqual(expected);
  });
});

const MERGE_CASES: readonly CellCase[] = [
  ["a draft", { facts: { isDraft: true, reviewDecision: "CHANGES_REQUESTED" } }, ["✅", "✅", "⏸ draft"]],
  ["changes requested", { facts: { reviewDecision: "CHANGES_REQUESTED" } }, ["✅", "✅", "⚠️ changes requested"]],
  ["a conflict", { facts: { mergeable: "CONFLICTING" } }, ["✅", "✅", "⚠️ conflict"]],
  ["a dirty merge state", { facts: { mergeStateStatus: "DIRTY" } }, ["✅", "✅", "⚠️ conflict"]],
];

describe("status table merge cell", () => {
  test.each(MERGE_CASES)("shows %s", async (_name, options, expected) => {
    expect(await cells(options)).toEqual(expected);
  });

  test("shows a merged PR with no CI or review state", async () => {
    const run = await runCli(PRETTY_STATUS, fakeReader({ facts: { state: "MERGED", mergedAt: "now" } }));
    expect(run.stdout).toContain("| — | — | ✅ merged |");
  });

  test("shows a closed PR with no CI or review state", async () => {
    const run = await runCli(PRETTY_STATUS, fakeReader({ facts: { state: "CLOSED" } }));
    expect(run.stdout).toContain("| — | — | ❌ closed |");
  });
});
