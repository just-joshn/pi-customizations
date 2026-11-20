import { describe, expect, test } from "bun:test";
import { failedCheck, fakeReader, pendingCheck } from "./fakes.test-helper.ts";
import { runCli, TARGET } from "./harness.test-helper.ts";
import { kindsOf } from "./output.test-helper.ts";

const OWNER_REPO = ["--owner", "owner", "--repo", "repo"] as const;
const QUEUE = ["--queued-stack", "--stack-prs", "1", ...OWNER_REPO] as const;
const TIMEOUT_SECONDS = "5";

describe("what the watcher asks GitHub for", () => {
  test("a settled check list also reads the commit rollups", async () => {
    const reader = fakeReader();
    await runCli(TARGET, reader);
    expect(reader.calls).toEqual(["pullRequest", "reviewThreadPage:null", "checksFastPath", "commitRollups"]);
  });

  test("a failed check list also reads the commit rollups", async () => {
    const reader = fakeReader({ fastPath: { kind: "checks", checks: [failedCheck()] } });
    await runCli(TARGET, reader);
    expect(reader.calls).toContain("commitRollups");
  });

  test("single mode reads rollups while checks are pending, for its status history", async () => {
    const reader = fakeReader({ fastPath: { kind: "checks", checks: [pendingCheck()] } });
    await runCli([...TARGET, "--timeout", TIMEOUT_SECONDS], reader);
    expect(reader.calls).toContain("commitRollups");
  });

  test("queued mode does not read rollups while the frontier's checks are pending", async () => {
    const reader = fakeReader({ fastPath: { kind: "checks", checks: [pendingCheck()] } });
    const run = await runCli([...QUEUE, "--timeout", TIMEOUT_SECONDS], reader);
    expect(kindsOf(run.lines).at(-1)).toBe("TIMEOUT");
    expect(reader.calls).not.toContain("commitRollups");
  });

  test("a merged PR is never asked for threads, checks or rollups", async () => {
    const reader = fakeReader({ facts: { state: "MERGED", mergedAt: "2026-07-26T00:00:00Z" } });
    await runCli(TARGET, reader);
    expect(reader.calls).toEqual(["pullRequest"]);
  });
});
