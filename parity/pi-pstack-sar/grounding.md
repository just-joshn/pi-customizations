# Subscription architecture grounding

## Overview

The user wants every pstack capability in the SAR report implemented through Pi mechanisms. The current port has real Task, loop, mode, plan, todo, ask, and subscription implementations. The substantial demonstrated design gap is durable subscription ownership.

## Current flow

`src/index.ts` registers subscriptions with a callback that starts a background Task for a new-session fire. `src/subscriptions/index.ts` persists branch-local subscriptions and mirrors a workspace registry. A detached supervisor normally owns timer, GitHub polling, and webhook listener arms. Its `deliver` function either writes an inbox event or launches a fresh headless Pi. Current creation chooses fresh spawning for every subscription. Therefore advertised owner-chat wakes never reach the live conversation through the normal durable path.

The workspace registry, branch snapshots, and supervisor each influence desired state. Restore unconditionally upserts old branch entries, so completed or cancelled subscriptions can reappear. List and unsubscribe only inspect the local live map, so a second session cannot reliably manage durable state.

## Known constraints

- Preserve public tool schemas and existing Pi extension hooks.
- Use `pi.sendMessage` for an owner-session wake and the existing `runFresh` callback for a live owner's new-session timer.
- Pi cannot safely share a session transcript writer across processes.
- Do not replace documented raw RPC with RpcClient at the cost of detached group cleanup or dialog cancellation.
- Keep offline automation for explicitly fresh-session timers. Do not silently equate wake_self with a new context-free run.
- Durable creation deduplicates workspace-wide by name. Management must use that same scope.
- Once completion and cancellation must survive branch restore.
- A webhook creation must not report a ready URL merely because a supervisor pid is alive.
- Every authenticated JSON POST is an event. Equal bodies do not mean equal events.

## Other demonstrated gaps

- `runner.ts` decodes arbitrary stdout chunks with Buffer.toString, which can corrupt split multibyte UTF-8.
- Several workflow skills hard-code the model-rule path rather than using the injected custom-agent-directory path.
- Benny checks the hidden skill catalog instead of installed resources.
- make-bot-ui describes obsolete process lifetime behavior.
- Package provenance omits the report's full source commits.
- Statechart suites are omitted from CI. The baseline with real TLC has 366 passes and a symlink fixture failure. The canonical-directory fixture fix now passes its narrow two-test check.

## Evidence

The report is `/Users/josh-desktop/Documents/pstack-sar-report.md`. The source checkout is `/Users/josh-desktop/src/experiments/plugins`, HEAD `ae5650febf4320793844c12c4adaa937f417f8da`, last pstack commit `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`. Explorer transcripts are the workspace subagents `7ca11ccc-a42b-4a0c-84e0-e6dd0837435a` and `86a43055-d1c8-4ab3-9540-ff5125695330`. Their findings are static traces, not completed runtime checks.
