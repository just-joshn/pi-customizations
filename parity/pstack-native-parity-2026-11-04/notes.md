# pstack → pi-pstack native parity run (2026-11-04)

Single-agent run. No subagents (operator instruction). Durable record for resume after compaction.

## Reference baseline (pinned)

| Component | Identity | Evidence |
| --- | --- | --- |
| cursor/plugins | `bb68f2365eceafa0cb2d253112f675acf5f144cc` = upstream `main` HEAD (`git ls-remote`, 2026-11-04T20:3xZ) | local checkout `/home/josh/Documents/GitHub/plugins` |
| pstack | 0.15.36, last change `c742dd6`. `git diff ae5650f..bb68f23 -- pstack cursor-team-kit` is empty | `pstack/.cursor-plugin/plugin.json` |
| Installed Cursor plugin cache | `~/.cursor/plugins/cache/cursor-public/pstack/ae5650fe…` byte-identical to checkout (`diff -rq`: only `.cache-complete`) | |
| cursor-team-kit | 1.2.0 (same revision). NOT installed in the user's Cursor cache; reference config = pstack + team-kit per mission | `cursor-team-kit/.cursor-plugin/plugin.json` |
| Cursor CLI | `2026.10.22-27dcf5f` (`~/.local/share/cursor-agent/versions/2026.10.22-27dcf5f`) | `cursor-agent --version` |
| Cursor IDE | 3.27.22 (`b1aa50cb6db8…`) | `cursor --version` |
| Cursor built-in skills | `~/.cursor/skills-cursor/*` (loop, create-skill, autopilot, canvas, …) | |
| Pi | `@earendil-works/pi-coding-agent` 1.5.0 (installed release and package devDependency) | `pi --version` |
| pi-pstack | `0.15.36-pi.13` at repo `96cc1857` (installed npm copy identical) | |

Upstream's own harness port (`scripts/generate-pstack-harness-trees.mjs`, `pstack/docs/harness/claude-code.md`) keeps skill text verbatim and adds one adapter line. Its `TERMS` list is an upstream-authored inventory of the Cursor names pstack skills use. Used here as a completeness anchor.

## Tree comparison (tree-diff.mjs → tree-diff.json)

602 reference files: 520 byte-identical, 73 modified, 0 missing, 9 unmapped by design (manifests, .gitignore, claude-code adapter, team-kit README/avatar, the two `.mdc` rules which ride `pstack_host`). Extras: `skills/create-skill` (stands in for Cursor's built-in), `skills/no-inline-imports`, `skills/typescript-exhaustive-switch`, three docs.

## Findings log

(ID, status, summary. Details in inventory.md.)

- **G1 FIXED (f261f35f), high.** Cursor's Shell runs commands in the background (`block_until_ms: 0`, or auto-background after `block_until_ms`), wakes the agent on output matches (`notify_on_output`) and on completion (`<system_notification>` with `kind: shell`), writes `~/.cursor/projects/<slug>/terminals/<id>.txt` with a header/footer, and polls with `AwaitShell`. pstack relies on it: babysit "watcher output drives wakeups", worktree-cleanup "background it", pr-review-canvas "run this backgrounded", and Cursor's built-in `/loop` local mechanism (event-gated dynamic wakes). pi-pstack has no background shell at all. Evidence: `.audit/pstack-native-parity-2026-11-04/cursor/shell-*.jsonl`, `subagent-bg-shell.jsonl`.
  - Observed: `-p` runs wait for background shells before exiting (never exit for `sleep 100000`; killed by timeout, child shell gone). A subagent's background shell outlives the subagent's Task result; the parent gets the `kind: shell` notification (status `aborted` in the probe).
- **G2 FIXED (8bdfc50c), high on this host.** pi-pstack's readonly `bash` fails closed on hosts with `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04+ default): sandbox-runtime's apply-seccomp needs a nested user namespace. Every readonly subagent (how/why explorers, judges) loses its shell. Cursor's documented readonly contract is "no file edits, no state-changing shell commands" (read-only commands work); the CLI does not enforce readonly at all. Baseline: `bun run test` → 5 failures, all readonly-shell positives.
- **G3 FIXED (577858fb), low.** Cursor's `/loop` skill runs the prompt once immediately when arming; pi-pstack's agent-armed `Loop` first runs after the interval and the host line does not say to run it now.
- **G5 FIXED (b6fb2af9), low.** Cursor subagents have no AskQuestion (evidence `subagent-tools.jsonl`); pi-pstack subagents keep it and get `skipped`.
- **D1 APPLIED (37b862a5).** Some skill-text adaptations add instructions with no host cause (e.g. architect runner-prompt port note). Policy: keep a change only when the verbatim text would make the model do something wrong or impossible on Pi.
- **NOT GAPS (checked):** Task result/notification texts match Cursor evidence (minus `<user_query>`/`<timestamp>` wrappers Pi does not use); unknown subagent_type and invalid model errors; Cursor dash slugs still resolve on Pi (`resolveDashSlug`); custom-mode notices match `custom-modes-module.js`; scripts: watch-pr 61/61 bun tests, statechart 267 pass / 67 skipped (TLC jar absent, same dependency on both hosts).

- **G6 FIXED (60258c6e), low.** Cursor's user info states today's date; Pi's system prompt has none. pstack's history slicing (automate-me) and team-kit's weekly-review/what-did-i-get-done need it.

## Status (2026-11-04T22:08Z)

- Commits on `feat/pi-pstack-background-shell-readonly-parity`, in order: 7aa7b5bf (biome format on main's files), d242b200 (a flaky subscription test waits for file content), f261f35f (G1, with the long-command host guidance), 8bdfc50c (G2), 577858fb (G3), b6fb2af9 (G5), 60258c6e (G6), 37b862a5 (D1), 0b15d6d0 (docs), then this record and the 0.15.36-pi.14 release commit.
- Package suite: 707 passed, 1 skipped (macOS-only sandbox-runtime dependency test). Baseline was 5 failing readonly checks. `make verify` green except one pi-maintainer timing flake under the parallel coverage run (passes alone, 1949/1949).
- Inventory: `inventory.md` (host rows) + `content-rows.md` (95 content units). `completeness-audit.mjs`: 165 reference files, 0 unmapped host lines.
- Live Pi (claude-sonnet-4-5): background-it, readonly-git-log, loop-arm, event-watcher, long-poller, and live-e2e setup/poteto/delegate/nocomments pass (`.audit/.../pi/`). Cursor comparison: live-background-it, live-event-watcher, subagent-askquestion (`.audit/.../cursor/`).

## Remaining (not fixable in Pi without a hosted service)

- TASK-ENV / CLOUD-CHAT: Cursor cloud VMs, `/in-cloud`, cloud Projects that run with the laptop closed. Pi: local worktrees and a local supervisor.
- AUTO-BENNY: Cursor Automations' hosted Slack trigger. Pi: timer sweep or a user-run relay into a webhook routine.
- MEDIA: inline video in chat. Pi: system player.
- IMAGE: needs an image model configured in Pi.

## Documented differences (deliberate)

- TASK-RESUME steers a running agent (pstack's own text assumes it; Cursor CLI 2026.10.22 rejects it).
- RULE-MODELS applies from the next request, not the next chat.
- SHELL-BG: an awaited job sends no duplicate notice; a subagent's jobs stop with the subagent.
- PLAN: tool allowlist + sandbox instead of instruction-only restriction.
- TASK-FORK: idle source only.
