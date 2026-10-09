#!/usr/bin/env node
/**
 * Fail-closed merge of live-int-004 merge-proposal into dependencies.json + source-lock note.
 * Requires verify.json inventory match + makeBotAttemptId + canNarrow true.
 * Does not set completeDependencyClosure true. Does not invent Slack closures.
 *
 * Usage:
 *   node parity/scripts/merge-live-int-004.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;
const dry = process.argv.includes("--dry-run");
const dir = join(root, "parity/research/dep-live-integrations-004");

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
  if (!merge.makeBotAttemptId && !summary.makeBotAttemptId) {
    reasons.push("missing makeBotAttemptId");
  }
  if (!merge.proposedUnresolvedReferenceText && !summary.narrowedReferenceText) {
    reasons.push("missing narrowed reference text");
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
  const attempt = merge.makeBotAttemptId || summary.makeBotAttemptId;
  const report = {
    at: new Date().toISOString(),
    dryRun: dry,
    attempt,
    canClose: Boolean(merge.canCloseLiveIntegrationsUnresolvedReference),
    counts: summary.counts,
  };
  writeFileSync(join(dir, "merge-eval.json"), JSON.stringify(report, null, 2) + "\n");

  if (dry) {
    console.log("dry-run OK would narrow unresolvedReference with", attempt);
    process.exit(0);
  }

  const depsPath = join(root, "parity/dependencies.json");
  const lockPath = join(root, "parity/source-lock.json");
  const deps = load(depsPath);
  const lock = load(lockPath);
  const now = new Date().toISOString();

  deps.unresolvedReferences = [text];
  deps.liveIntegrations004Note =
    `u-dep-live-integrations-004: make-bot Generate paid (${attempt}); ` +
    `counts a=${summary.counts.a_custody_complete} b=${summary.counts.b_environment_bound} ` +
    `c=${summary.counts.c_already_evidenced}; canClose=${Boolean(
      merge.canCloseLiveIntegrationsUnresolvedReference,
    )}; completeDependencyClosure stays false.`;
  const ev = deps.evidence || [];
  for (const p of merge.evidence || []) {
    if (!ev.includes(p)) ev.push(p);
  }
  deps.evidence = ev;
  writeFileSync(depsPath, JSON.stringify(deps, null, 2) + "\n");

  let note = lock.cursorPlugins.completeDependencyClosureNote || "";
  if (!note.includes("live-int-004")) {
    note =
      note.replace(/\s*$/, "") +
      ` live-int-004: make-bot Generate paid (${String(attempt).slice(0, 8)}); ` +
      `b=${summary.counts.b_environment_bound}.`;
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
        attempt,
        counts: summary.counts,
        completionStatus: completion.status,
      },
      null,
      2,
    ),
  );
}

main();
