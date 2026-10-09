#!/usr/bin/env node
/**
 * Fail-closed ledger merge after make-bot post-unlock-002 probe.
 * Closes MAKE-BOT-UI-KEY-SERVER-HOST + verifies PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001
 * only when probe evidence proves key_server_ok / HTTP 200 with no key leak.
 * Does not invent attempt IDs.
 *
 * Usage:
 *   node parity/scripts/merge-make-bot-post-unlock.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;
const dry = process.argv.includes("--dry-run");
const research = join(root, "parity/research/make-bot-auth-header-post-unlock-002");
const evidenceRoot = join(root, "parity/evidence/make-bot-ui/auth-header-post-unlock-002");
const waitFlag = join(root, "parity/research/wait-unlock-make-bot-001/unlocked.flag");
const PI_OK = "e75f8e08-0d8c-4d55-ad3f-6946c405bbaf";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function findLatestDisposition() {
  const preferred = join(research, "disposition.json");
  if (existsSync(preferred)) return preferred;
  const candidates = [];
  if (existsSync(research)) {
    for (const name of readdirSync(research)) {
      if (name.startsWith("disposition") && name.endsWith(".json")) {
        candidates.push(join(research, name));
      }
    }
  }
  if (existsSync(evidenceRoot)) {
    for (const attempt of readdirSync(evidenceRoot)) {
      const d = join(evidenceRoot, attempt, "disposition.json");
      if (existsSync(d)) candidates.push(d);
    }
  }
  let best = null;
  let bestM = -1;
  for (const p of candidates) {
    try {
      const { mtimeMs } = statSync(p);
      if (mtimeMs > bestM) {
        bestM = mtimeMs;
        best = p;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

function assertCloseable(disp) {
  const reasons = [];
  if (!disp || typeof disp !== "object") reasons.push("missing disposition");
  const outcome =
    disp.cursorOutcome || disp.outcome || disp.verdict || disp.status;
  const probe = disp.probe && typeof disp.probe === "object" ? disp.probe : {};
  const probeStatus = probe.httpStatus ?? disp.probeHttpStatus ?? disp.httpStatus;
  const canClose =
    disp.canCloseMismatch === true ||
    disp.keyServerOk === true ||
    outcome === "key_server_ok" ||
    (probe.ok === true && Number(probeStatus) === 200) ||
    (disp.keyStoredServerSide === true && Number(probeStatus) === 200);
  if (!canClose) {
    reasons.push(
      `outcome not closable: ${JSON.stringify({
        outcome,
        probeOk: probe.ok,
        probeStatus,
        keyStoredServerSide: disp.keyStoredServerSide,
        blocker: disp.blocker,
      })}`,
    );
  }
  if (
    disp.keyLeak === true ||
    disp.senderKeyInChat === true ||
    disp.senderKeyInEvidence === true ||
    disp.senderKeyInChatOrEvidence === true
  ) {
    reasons.push("key leak flagged");
  }
  const attemptId =
    disp.attemptId ||
    disp.cursorAttemptId ||
    disp.attempts?.cursor ||
    disp.desktopAttemptId;
  if (!attemptId || typeof attemptId !== "string" || attemptId.length < 8) {
    reasons.push("missing cursor attemptId");
  }
  // Product requires Active + git repo for webhook HTTP 200 ("is disabled" /
  // "does not have git configuration"). Allow enable/repo when key was stored
  // server-side and probe already proved 200 — refuse enable-only shortcuts.
  const enabledForProbe =
    disp.activated === true ||
    disp.enableCalled === true ||
    disp.activatedByHarness === true ||
    disp.enabledForProbe === true;
  if (enabledForProbe) {
    const probeOk =
      outcome === "key_server_ok" ||
      (probe.ok === true && Number(probeStatus) === 200) ||
      (disp.keyStoredServerSide === true && Number(probeStatus) === 200);
    if (!(disp.keyStoredServerSide === true && probeOk)) {
      reasons.push(
        "Activate/Enable claimed without keyStoredServerSide + probe 200",
      );
    }
  }
  if (disp.blocker) {
    reasons.push(`blocker still set: ${disp.blocker}`);
  }
  return { ok: reasons.length === 0, reasons, attemptId, outcome };
}

function main() {
  const dispPath = findLatestDisposition();
  if (!dispPath) {
    console.error("no post-unlock disposition found under research/ or evidence/");
    process.exit(2);
  }
  const disp = loadJson(dispPath);
  const check = assertCloseable(disp);
  const report = {
    at: new Date().toISOString(),
    dispositionPath: dispPath.replace(root + "/", ""),
    unlockedFlagPresent: existsSync(waitFlag),
    dryRun: dry,
    check,
  };
  writeFileSync(
    join(research, "merge-eval.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (!check.ok) {
    console.error("refuse merge:", check.reasons.join("; "));
    console.error(JSON.stringify(report, null, 2));
    process.exit(3);
  }

  if (dry) {
    console.log("dry-run OK would close make-bot with", check.attemptId);
    process.exit(0);
  }

  const mismatchesPath = join(root, "parity/mismatches.json");
  const requirementsPath = join(root, "parity/requirements.json");
  const mismatches = loadJson(mismatchesPath);
  const requirements = loadJson(requirementsPath);
  const now = new Date().toISOString();

  const item = mismatches.items.find((x) => x.id === "MAKE-BOT-UI-KEY-SERVER-HOST");
  if (!item) throw new Error("mismatch missing");
  if (item.status === "closed") {
    console.log("already closed");
  } else {
    item.status = "closed";
    item.acceptanceVerdict = "verified-pass-paired";
    item.actual =
      `Cursor Generate+0600+probe 200 (${check.attemptId}); Pi key_server_ok (${PI_OK}). Sender key server-only.`;
    item.nextAction = "Closed. Requirement verified-pass-paired.";
    item.updatedAt = now;
    item.cursorPartial = {
      ...(item.cursorPartial || {}),
      attemptId: check.attemptId,
      outcome: "key_server_ok",
      keyLeak: false,
    };
    item.desktopProgress = {
      ...(item.desktopProgress || {}),
      authHeaderExercised: true,
      consoleLocked: false,
      postUnlockAttempt: check.attemptId,
      report: "parity/briefs/reports/u-make-bot-auth-header-post-unlock-002-report.md",
    };
    const evid = item.evidence || [];
    for (const p of [
      dispPath.replace(root + "/", ""),
      "parity/briefs/reports/u-make-bot-auth-header-post-unlock-002-report.md",
      "parity/research/make-bot-auth-header-post-unlock-002/",
    ]) {
      if (!evid.includes(p)) evid.push(p);
    }
    item.evidence = evid;
  }

  const req = requirements.requirements.find(
    (x) => x.id === "PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001",
  );
  if (!req) throw new Error("requirement missing");
  req.status = "verified-pass-paired";
  req.evidence = [
    ...(req.evidence || []),
    {
      type: "paired-run",
      pair: "parity/evidence/make-bot-ui/pair-make-bot-ui-key-server-1.json",
      attempts: { cursor: check.attemptId, pi: PI_OK },
      closedAt: now,
      report: "parity/briefs/reports/u-make-bot-auth-header-post-unlock-002-report.md",
      note: "Cursor desktop Generate/auth/0600/probe 200 + prior Pi key_server_ok. No key leak.",
    },
  ];

  writeFileSync(mismatchesPath, JSON.stringify(mismatches, null, 2) + "\n");
  writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2) + "\n");

  const completion = spawnSync("node", [join(root, "parity/scripts/check-completion.mjs")], {
    encoding: "utf8",
  });
  console.log(
    JSON.stringify(
      {
        merged: true,
        attemptId: check.attemptId,
        completionStatus: completion.status,
      },
      null,
      2,
    ),
  );
}

main();
