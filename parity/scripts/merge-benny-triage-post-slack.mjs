#!/usr/bin/env node
/**
 * Fail-closed stub for closing BENNY-TRIAGE-VALID-CONFIG-ENV after a valid-config pair.
 * Refuses until a disposition with canCloseMismatch=true and attempt IDs exists.
 * Does not invent Slack posts.
 *
 * Usage:
 *   node parity/scripts/merge-benny-triage-post-slack.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;
const dry = process.argv.includes("--dry-run");
const research = join(root, "parity/research/benny-triage-valid-post-slack-001");

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function findDisposition() {
  const preferred = join(research, "disposition.json");
  if (existsSync(preferred)) return preferred;
  if (!existsSync(research)) return null;
  let best = null;
  let bestM = -1;
  for (const name of readdirSync(research)) {
    if (!name.includes("disposition") || !name.endsWith(".json")) continue;
    const p = join(research, name);
    const { mtimeMs } = statSync(p);
    if (mtimeMs > bestM) {
      bestM = mtimeMs;
      best = p;
    }
  }
  return best;
}

function main() {
  const path = findDisposition();
  if (!path) {
    console.error("no benny-triage post-slack disposition; refuse");
    process.exit(2);
  }
  const disp = load(path);
  const reasons = [];
  if (disp.canCloseMismatch !== true && disp.verdict !== "pass") {
    reasons.push(`not closable: ${disp.canCloseMismatch ?? disp.verdict}`);
  }
  const cursor = disp.attempts?.cursor || disp.cursorAttemptId || disp.attemptId;
  const pi = disp.attempts?.pi || disp.piAttemptId;
  if (!cursor || !pi) reasons.push("missing cursor/pi attempt IDs");
  if (disp.fabricatedSlack === true) reasons.push("fabricatedSlack flagged");
  if (reasons.length) {
    console.error("refuse:", reasons.join("; "));
    process.exit(3);
  }
  if (dry) {
    console.log("dry-run OK would close Benny triage with", cursor, pi);
    process.exit(0);
  }

  const now = new Date().toISOString();
  const mismatchesPath = join(root, "parity/mismatches.json");
  const requirementsPath = join(root, "parity/requirements.json");
  const mismatches = load(mismatchesPath);
  const requirements = load(requirementsPath);
  const item = mismatches.items.find((x) => x.id === "BENNY-TRIAGE-VALID-CONFIG-ENV");
  const req = requirements.requirements.find(
    (x) => x.id === "PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001",
  );
  if (!item || !req) throw new Error("ledger rows missing");

  item.status = "closed";
  item.acceptanceVerdict = "verified-pass-paired";
  item.nextAction = "Closed. Requirement verified-pass-paired.";
  item.updatedAt = now;
  item.actual =
    `Valid-config Benny triage pair (cursor ${cursor}, pi ${pi}). Thread-only verdict; no reproduce-or-fix in triage.`;
  req.status = "verified-pass-paired";
  req.evidence = [
    ...(req.evidence || []),
    {
      type: "paired-run",
      pair: "parity/evidence/benny-triage/pair-benny-triage-valid-1.json",
      attempts: { cursor, pi },
      closedAt: now,
      report: "parity/briefs/reports/u-journey-cmd-benny-triage-valid-post-slack-001-report.md",
    },
  ];
  writeFileSync(mismatchesPath, JSON.stringify(mismatches, null, 2) + "\n");
  writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2) + "\n");
  const completion = spawnSync("node", [join(root, "parity/scripts/check-completion.mjs")], {
    encoding: "utf8",
  });
  console.log(JSON.stringify({ merged: true, cursor, pi, completionStatus: completion.status }, null, 2));
}

main();
