#!/usr/bin/env node
/**
 * Fail-closed merge of live-int-005 into dependencies.json + source-lock note.
 * Requires verify inventory match + Benny attempt IDs + canNarrow.
 * Does not set completeDependencyClosure true.
 *
 * Usage:
 *   node parity/scripts/merge-live-int-005.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;
const dry = process.argv.includes("--dry-run");
const dir = join(root, "parity/research/dep-live-integrations-005");

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  for (const name of ["merge-proposal.json", "summary.json", "verify.json"]) {
    if (!existsSync(join(dir, name))) {
      console.error(`missing ${name}; refuse`);
      process.exit(2);
    }
  }
  const merge = load(join(dir, "merge-proposal.json"));
  const summary = load(join(dir, "summary.json"));
  const verify = load(join(dir, "verify.json"));
  const reasons = [];
  if (!verify.inventorySha256Match) reasons.push("inventory sha mismatch");
  if (verify.fabricatedLiveEvidence) reasons.push("fabricated flag set");
  if (!merge.bennyTriageCursorAttemptId || !merge.bennyTriagePiAttemptId) {
    reasons.push("missing Benny attempt IDs");
  }
  if (!merge.proposedUnresolvedReferenceText && !summary.narrowedReferenceText) {
    reasons.push("missing narrowed reference text");
  }
  if ((summary.delta && summary.delta.reclassifiedRows) !== 44) {
    reasons.push(`expected 44 reclass rows, got ${summary.delta?.reclassifiedRows}`);
  }
  if (merge.status === "merged") {
    console.log("already merged");
    process.exit(0);
  }
  if (reasons.length) {
    console.error("refuse:", reasons.join("; "));
    process.exit(3);
  }

  const text =
    merge.proposedUnresolvedReferenceText || summary.narrowedReferenceText;
  const cursor = merge.bennyTriageCursorAttemptId;
  const pi = merge.bennyTriagePiAttemptId;
  const report = {
    at: new Date().toISOString(),
    dryRun: dry,
    cursor,
    pi,
    canClose: Boolean(merge.canCloseLiveIntegrationsUnresolvedReference),
    counts: summary.counts,
  };
  writeFileSync(join(dir, "merge-eval.json"), JSON.stringify(report, null, 2) + "\n");

  if (dry) {
    console.log("dry-run OK would narrow unresolvedReference with", cursor.slice(0, 8));
    process.exit(0);
  }

  const depsPath = join(root, "parity/dependencies.json");
  const lockPath = join(root, "parity/source-lock.json");
  const deps = load(depsPath);
  const lock = load(lockPath);
  const now = new Date().toISOString();

  deps.unresolvedReferences = [text];
  deps.liveIntegrations005Note =
    `u-dep-live-integrations-005: Benny Slack triage+thread-safety paid ` +
    `(cursor ${cursor}, pi ${pi}); counts a=${summary.counts.a_custody_complete} ` +
    `b=${summary.counts.b_environment_bound} c=${summary.counts.c_already_evidenced}; ` +
    `canClose=${Boolean(merge.canCloseLiveIntegrationsUnresolvedReference)}; ` +
    `completeDependencyClosure stays false.`;
  deps.liveIntegrations005MergedAt = now;
  const ev = deps.evidence || [];
  for (const p of merge.evidence || []) {
    if (!ev.includes(p)) ev.push(p);
  }
  deps.evidence = ev;
  writeFileSync(depsPath, JSON.stringify(deps, null, 2) + "\n");

  let note = lock.cursorPlugins.completeDependencyClosureNote || "";
  if (!note.includes("live-int-005")) {
    note =
      note.replace(/\s*$/, "") +
      ` live-int-005: Benny Slack paid (${cursor.slice(0, 8)}/${pi.slice(0, 8)}); ` +
      `b=${summary.counts.b_environment_bound} (G11+webhook+automations+G1+G2 remain).`;
  }
  lock.cursorPlugins.completeDependencyClosureNote = note;
  lock.lastObservedAt = now;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");

  merge.status = "merged";
  merge.mergedAt = now;
  writeFileSync(join(dir, "merge-proposal.json"), JSON.stringify(merge, null, 2) + "\n");

  const completion = spawnSync("node", [join(root, "parity/scripts/check-completion.mjs")], {
    encoding: "utf8",
  });
  console.log(
    JSON.stringify(
      {
        merged: true,
        cursor,
        pi,
        counts: summary.counts,
        completionStatus: completion.status,
      },
      null,
      2,
    ),
  );
}

main();
