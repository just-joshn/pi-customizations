#!/usr/bin/env node
/**
 * Rerunable cross-check for u-operator-gates-refresh-002.
 * Reads ledgers only. Exits 0 when measured state matches expected snapshot.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const completion = JSON.parse(readFileSync(join(root, "completion.json"), "utf8"));
const mismatches = JSON.parse(readFileSync(join(root, "mismatches.json"), "utf8"));
const checklist = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "grant-checklist.json"), "utf8"),
);

const openIds = mismatches.items.filter((x) => x.status === "open").map((x) => x.id);
const expectedOpen = [
  "BENNY-TRIAGE-VALID-CONFIG-ENV",
  "MAKE-BOT-UI-KEY-SERVER-HOST",
  "SETUP-BENNY-THREAD-SAFETY-ENV",
];
const errors = [];

if (completion.verdict !== "BLOCKED") errors.push(`verdict=${completion.verdict}`);
if (completion.blockers.length !== 13) errors.push(`blockers=${completion.blockers.length}`);
if (completion.requirementCount !== 98) errors.push(`requirementCount=${completion.requirementCount}`);
const verified = JSON.parse(readFileSync(join(root, "requirements.json"), "utf8")).requirements.filter(
  (r) => r.status === "verified-pass-paired",
).length;
if (verified !== 94) errors.push(`verified=${verified}`);
if (JSON.stringify(openIds) !== JSON.stringify(expectedOpen)) {
  errors.push(`openMismatchIds=${JSON.stringify(openIds)}`);
}
if (checklist.blockerCount !== 13) errors.push(`checklist.blockerCount=${checklist.blockerCount}`);
if (checklist.openMismatchIds.join(",") !== expectedOpen.join(",")) {
  errors.push(`checklist.openMismatchIds mismatch`);
}
if (checklist.remainingOperatorGrantCount !== 11) {
  errors.push(`grantCount=${checklist.remainingOperatorGrantCount}`);
}

if (errors.length) {
  console.error("FAIL", errors.join("; "));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      evaluatedAt: completion.evaluatedAt,
      blockers: completion.blockers.length,
      verifiedPaired: verified,
      openMismatchIds: openIds,
      remainingOperatorGrantCount: checklist.remainingOperatorGrantCount,
    },
    null,
    2,
  ),
);
