#!/usr/bin/env node
/**
 * Poll Mac console unlock, then signal ready for make-bot auth capture.
 * Writes unlocked.flag and exits 0 on unlock. Does not edit ledgers.
 * osascript calls are hard-timeout'd so a locked loginwindow cannot stall the loop.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const outDir = join(root, "parity/research/wait-unlock-make-bot-001");
mkdirSync(outDir, { recursive: true });

const maxMs = Number(process.env.PARITY_UNLOCK_WAIT_MS || 45 * 60 * 1000);
const pollMs = Number(process.env.PARITY_UNLOCK_POLL_MS || 5000);
const started = Date.now();

function run(cmd, args, timeoutMs = 4000) {
  return spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" });
}

function helperDesktopReady() {
  const helper =
    process.env.CURSOR_AGENT_HELPER ||
    `${process.env.HOME}/.cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper`;
  const r = run(helper, ["desktop-share-status", "--mode", "view_and_control"], 8000);
  try {
    return JSON.parse((r.stdout || "").trim());
  } catch {
    return {
      parseError: true,
      status: r.status,
      stdoutTail: (r.stdout || "").slice(-200),
      stderrTail: (r.stderr || "").slice(-200),
    };
  }
}

function unlockCensus() {
  const r = run("ioreg", ["-n", "Root", "-d1"], 5000);
  const m = /"IOConsoleLocked"\s*=\s*(\w+)/.exec(r.stdout || "");
  const ioregLocked = (m?.[1] || "Yes") === "Yes";
  const se = run("osascript", [
    "-e",
    'tell application "System Events" to tell process "Cursor" to count of windows',
  ]);
  const lw = run("osascript", [
    "-e",
    'tell application "System Events" to tell process "loginwindow" to count of windows',
  ]);
  const winCount = Number((se.stdout || "").trim());
  const loginWins = Number((lw.stdout || "").trim());
  // Cursor glass/Electron often reports 0 AXWindow via System Events while the
  // agent-helper still sees a key window and can drive Generate. Prefer helper
  // desktop-share readiness when ioreg + loginwindow agree the console is open.
  const helper = helperDesktopReady();
  const helperReady =
    helper &&
    helper.ready === true &&
    helper.screenLocked === false &&
    helper.accessibility === true;
  const seCursorReady = Number.isFinite(winCount) && winCount > 0;
  const cursorReady = seCursorReady || helperReady;
  const loginGone = Number.isFinite(loginWins) && loginWins === 0;
  const ready = !ioregLocked && cursorReady && loginGone && helperReady !== false;
  // Fail closed if helper explicitly says locked even when ioreg briefly disagrees.
  const readyFinal =
    ready && !(helper && helper.screenLocked === true) && !ioregLocked;
  return {
    ioregLocked,
    winCount: Number.isFinite(winCount) ? winCount : -1,
    loginWins: Number.isFinite(loginWins) ? loginWins : -1,
    seStatus: se.status,
    lwStatus: lw.status,
    seTimedOut: Boolean(se.error && se.error.code === "ETIMEDOUT"),
    lwTimedOut: Boolean(lw.error && lw.error.code === "ETIMEDOUT"),
    seCursorReady,
    helperReady,
    helper,
    ready: readyFinal,
  };
}

const log = [];
function note(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  log.push(line);
  console.log(line);
}

note(`wait start maxMs=${maxMs}`);
let last = null;
let lastOpenAttemptMs = 0;
while (Date.now() - started < maxMs) {
  const c = unlockCensus();
  last = c;
  note(
    `ready=${c.ready} ioregLocked=${c.ioregLocked} cursorWins=${c.winCount} loginWins=${c.loginWins}` +
      ` helperReady=${c.helperReady} helperLocked=${c.helper?.screenLocked}` +
      (c.seTimedOut || c.lwTimedOut ? " osaTimeout=1" : ""),
  );
  writeFileSync(
    join(outDir, "wait-status.json"),
    JSON.stringify({ ...c, elapsedMs: Date.now() - started, at: new Date().toISOString() }, null, 2),
  );
  if (c.ready) break;
  // After Login clears, bring Cursor forward so window census can go ready.
  const unlockedNoCursor =
    !c.ioregLocked && c.loginWins === 0 && !(c.winCount > 0);
  if (unlockedNoCursor && Date.now() - lastOpenAttemptMs > 20_000) {
    lastOpenAttemptMs = Date.now();
    const opened = run("open", ["-a", "Cursor"], 8000);
    note(`open Cursor status=${opened.status} err=${opened.error?.code || ""}`);
  }
  run("sleep", [String(Math.max(1, Math.floor(pollMs / 1000)))], pollMs + 2000);
}

writeFileSync(join(outDir, "wait-log.txt"), log.join("\n") + "\n");

if (!last?.ready) {
  note("timeout still locked");
  process.exit(2);
}

const nextBrief = "parity/briefs/u-make-bot-auth-header-post-unlock-002.md";
const probePath = join(
  root,
  "parity/research/make-bot-auth-header-post-unlock-002/probe-auth-header.py",
);
writeFileSync(
  join(outDir, "unlocked.flag"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      census: last,
      nextBrief,
      probePath: "parity/research/make-bot-auth-header-post-unlock-002/probe-auth-header.py",
    },
    null,
    2,
  ) + "\n",
);
note("unlocked — ready for make-bot auth capture (post-unlock-002)");

// Settle: bring Cursor forward and wait so loginwindow is fully gone before AX/OCR.
{
  const opened = run("open", ["-a", "Cursor"], 8000);
  note(`post-unlock open Cursor status=${opened.status}`);
  const settleSec = Number(process.env.PARITY_UNLOCK_SETTLE_SEC || 5);
  run("sleep", [String(Math.max(1, settleSec))], (settleSec + 2) * 1000);
  const census = unlockCensus();
  note(
    `post-settle ready=${census.ready} ioregLocked=${census.ioregLocked} ` +
      `cursorWins=${census.winCount} loginWins=${census.loginWins}`,
  );
  writeFileSync(
    join(outDir, "post-settle-census.json"),
    JSON.stringify({ ...census, at: new Date().toISOString() }, null, 2) + "\n",
  );
  if (!census.ready) {
    note("post-settle census not ready — refusing probe");
    process.exit(4);
  }
}

// Default: run the staged probe immediately so the unlock window is not lost.
const runProbe = (process.env.PARITY_UNLOCK_RUN_PROBE || "1") !== "0";
if (runProbe) {
  note(`running probe ${probePath}`);
  const probe = run("python3", [probePath], 25 * 60 * 1000);
  writeFileSync(
    join(outDir, "probe-exit.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: probe.status,
        signal: probe.signal,
        error: probe.error ? String(probe.error) : null,
        stdoutTail: (probe.stdout || "").slice(-4000),
        stderrTail: (probe.stderr || "").slice(-4000),
      },
      null,
      2,
    ) + "\n",
  );
  note(`probe exit status=${probe.status} signal=${probe.signal || ""}`);
  if (probe.status === 0) {
    const mergePath = join(root, "parity/scripts/merge-make-bot-post-unlock.mjs");
    const runMerge = (process.env.PARITY_UNLOCK_RUN_MERGE || "1") !== "0";
    if (runMerge) {
      note(`running fail-closed merge ${mergePath}`);
      const merge = run("node", [mergePath], 60_000);
      writeFileSync(
        join(outDir, "merge-exit.json"),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            status: merge.status,
            stdoutTail: (merge.stdout || "").slice(-2000),
            stderrTail: (merge.stderr || "").slice(-2000),
          },
          null,
          2,
        ) + "\n",
      );
      note(`merge exit status=${merge.status}`);
      if (merge.status === 0) {
        const liveInt = join(
          root,
          "parity/research/dep-live-integrations-004/refresh_dispositions.py",
        );
        const runLiveInt = (process.env.PARITY_UNLOCK_RUN_LIVEINT || "1") !== "0";
        if (runLiveInt) {
          note(`running live-int-004 refresh ${liveInt}`);
          const li = run("python3", [liveInt], 120_000);
          writeFileSync(
            join(outDir, "live-int-004-exit.json"),
            JSON.stringify(
              {
                at: new Date().toISOString(),
                status: li.status,
                stdoutTail: (li.stdout || "").slice(-2000),
                stderrTail: (li.stderr || "").slice(-2000),
              },
              null,
              2,
            ) + "\n",
          );
          note(`live-int-004 exit status=${li.status}`);
          if (li.status === 0) {
            const liveMerge = join(root, "parity/scripts/merge-live-int-004.mjs");
            const runLiveMerge =
              (process.env.PARITY_UNLOCK_RUN_LIVEINT_MERGE || "1") !== "0";
            if (runLiveMerge) {
              note(`running live-int-004 ledger merge ${liveMerge}`);
              const lm = run("node", [liveMerge], 60_000);
              writeFileSync(
                join(outDir, "live-int-004-merge-exit.json"),
                JSON.stringify(
                  {
                    at: new Date().toISOString(),
                    status: lm.status,
                    stdoutTail: (lm.stdout || "").slice(-2000),
                    stderrTail: (lm.stderr || "").slice(-2000),
                  },
                  null,
                  2,
                ) + "\n",
              );
              note(`live-int-004 merge exit status=${lm.status}`);
            }
          }
        }
      }
    }
    process.exit(0);
  }
  process.exit(3);
}
process.exit(0);
