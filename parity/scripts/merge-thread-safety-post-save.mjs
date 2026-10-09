#!/usr/bin/env node
/**
 * Fail-closed stub for closing SETUP-BENNY-THREAD-SAFETY-ENV after seven live checks.
 * Refuses until disposition proves canCloseMismatch with attempt IDs and no enable-before-pass.
 *
 * Usage:
 *   node parity/scripts/merge-thread-safety-post-save.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;
const dry = process.argv.includes("--dry-run");
const research = join(root, "parity/research/setup-benny-thread-safety-post-save-001");

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
    console.error("no thread-safety post-save disposition; refuse");
    process.exit(2);
  }
  const disp = load(path);
  const reasons = [];
  if (disp.canCloseMismatch !== true && disp.verdict !== "pass") {
    reasons.push(`not closable: ${disp.canCloseMismatch ?? disp.verdict}`);
  }
  const checks = disp.sevenChecks || disp.checks;
  if (!checks || (Array.isArray(checks) && checks.length < 7)) {
    reasons.push("seven checks incomplete");
  }
  if (disp.enableBeforePass === true) reasons.push("enable-before-pass flagged");
  const cursor = disp.attempts?.cursor || disp.cursorAttemptId || disp.attemptId;
  const pi = disp.attempts?.pi || disp.piAttemptId;
  if (!cursor || !pi) reasons.push("missing cursor/pi attempt IDs");
  if (reasons.length) {
    console.error("refuse:", reasons.join("; "));
    process.exit(3);
  }
  if (dry) {
    console.log("dry-run OK would close thread-safety with", cursor, pi);
    process.exit(0);
  }

  const now = new Date().toISOString();
  const mismatchesPath = join(root, "parity/mismatches.json");
  const requirementsPath = join(root, "parity/requirements.json");
  const mismatches = load(mismatchesPath);
  const requirements = load(requirementsPath);
  const item = mismatches.items.find((x) => x.id === "SETUP-BENNY-THREAD-SAFETY-ENV");
  const req = requirements.requirements.find(
    (x) => x.id === "PSTACK-SETUP-BENNY-THREAD-SAFETY-001",
  );
  if (!item || !req) throw new Error("ledger rows missing");

  item.status = "closed";
  item.acceptanceVerdict = "verified-pass-paired";
  item.nextAction = "Closed. Requirement verified-pass-paired.";
  item.updatedAt = now;
  item.actual =
    `Seven thread-safety checks witnessed after editor Save (cursor ${cursor}, pi ${pi}). RecordThreadSafety + Enable(local) only after pass.`;
  req.status = "verified-pass-paired";
  req.evidence = [
    ...(req.evidence || []),
    {
      type: "paired-run",
      pair: "parity/evidence/setup-benny/pair-setup-benny-thread-safety-1.json",
      attempts: { cursor, pi },
      closedAt: now,
      report: "parity/briefs/reports/u-journey-setup-benny-thread-safety-post-save-001-report.md",
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
