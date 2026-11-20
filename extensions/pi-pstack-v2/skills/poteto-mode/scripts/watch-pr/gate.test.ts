import { expect, test } from "bun:test";
import { GH_TARGET, json, rawFastCheck, rollupPage, exit, useGhCli, type GhRoutes } from "./gh.test-helper.ts";
import { get } from "./output.test-helper.ts";

const cli = useGhCli();
const FAST_PATH_PENDING_EXIT = 8;
const EXIT_FAILING_CHECKS = 4;
const GATE = "Code Review Gate";

const gateInRollup = (node: unknown): GhRoutes => ({
  checks: () => exit(FAST_PATH_PENDING_EXIT),
  rollup: () => json(rollupPage([node])),
});

async function expectsReadyOnGate(routes: GhRoutes): Promise<void> {
  const run = await cli.run(GH_TARGET, routes);
  expect(run.code).toBe(0);
  expect(run.sleeps).toEqual([]);
  expect(get(run.lines[0], "kind")).toBe("READY");
  expect(get(run.lines[0], "scope.pr.proof.ci.all.0.kind")).toBe("code-review-gate");
}

test("Code Review Gate: does not wait on a gate still in progress in the rollup", () =>
  expectsReadyOnGate(gateInRollup({ __typename: "CheckRun", name: GATE, status: "IN_PROGRESS", conclusion: null })));

test("Code Review Gate: does not wait on a pending StatusContext gate", () =>
  expectsReadyOnGate(gateInRollup({ __typename: "StatusContext", context: GATE, state: "PENDING" })));

test("Code Review Gate: does not fail on a gate waiting for an owner approval", () => {
  const node = { __typename: "CheckRun", name: GATE, status: "COMPLETED", conclusion: "ACTION_REQUIRED" };
  return expectsReadyOnGate(gateInRollup({ ...node, description: "1 of 2 policies" }));
});

test("Code Review Gate: does not fail on a gate gh pr checks reports as action required", () =>
  expectsReadyOnGate({ checks: () => json([rawFastCheck(GATE, "fail", "ACTION_REQUIRED")]) }));

test("Code Review Gate: an ordinary check that needs action still fails", async () => {
  const run = await cli.run(GH_TARGET, { checks: () => json([rawFastCheck("ci", "fail", "ACTION_REQUIRED")]) });
  expect(run.code).toBe(EXIT_FAILING_CHECKS);
  expect(get(run.lines[0], "blocker.ci.failed.0.reportedState")).toBe("ACTION_REQUIRED");
});
