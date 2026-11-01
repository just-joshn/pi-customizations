# Gaps blocking 100% user-visible plugin parity

Scope: user-visible pstack + poteto soft-dep behavior on Pi, with Pi-native mechanisms. Cursor enterprise / Computer Use cloud platform witnessing is **out of scope** for this list (see `closure.md` dispositions `cursor-platform-out-of-scope-with-pi-substitute`). This unit does **not** claim parity acceptance.

Inventory finding: tip skill/agent/automation trees are present under `extensions/pi-pstack`; the three team-kit soft-dep `SKILL.md` files are byte-identical to tip team-kit; host features skills name have Pi implementations or documented substitutes (`host-feature-map.md`). Gaps 1–3 below are closed. What remains is host-catalog residual (model diversity, optional image model) and documented Cursor-platform substitutes, not missing inventory paths.

## Ranked by risk

### 1. High. Routine and timer lifetime ends with the Pi process — CLOSED (Pi supervisor)

**User notice (before).** Benny overnight timers, `make-bot-ui` webhooks, and `subscribe_*` wakes stopped when the Pi process exited.

**Pi-native close.** Desired state dual-writes to `durable/<slug>/subscriptions.json`. Creating a subscription auto-starts `pstack-routines-supervisor`, which arms timers/polls/webhooks after chat exit and claims fires idempotently. Optional launchd/systemd under `packaging/` cover reboot. Proven by `test/durable-store.test.ts`, `test/supervisor-reconcile.test.ts`, and ensure-supervisor handoff in `test/subscriptions.test.ts`.

**Residual.** Reboot without a user agent still needs packaging install. Cursor-hosted Automations cloud identity remains out of scope (`cursor-platform-out-of-scope-with-pi-substitute`). Real-bin chat-exit smoke VERIFIED after watch-timer keep-alive fix (`durable-routines-design/chat-exit-smoke.md`).

### 2. Medium. Generated images need Pi codemode + image model — CLOSED (substitute + gate)

**Pi-native close.** Host section names `models.generateImages()` when codemode + image model are configured. Otherwise Mermaid/table. Proven by `test/sections.test.ts` and `test/e2e/host.e2e.test.ts` HOST-006 with a fixture image model.

**Residual.** Visual artifact type still depends on the operator's Pi image-model config. That is host catalog, not a missing package feature.

### 3. Medium. `create-skill` soft-dep is a shorter Pi rewrite — CLOSED (depth)

**Pi-native close.** `skills/create-skill/SKILL.md` is now 17633 bytes (Cursor builtin 15034) with Pi paths and full interview/structure coverage. Harness requires `> 12 KiB`.
### 4. Medium. Swarm / role model diversity follows the Pi provider catalog — residual (host catalog)

**User notice.** poteto defaults and `/setup-pstack` budgets name families and optional `-fast` variants. Task resolves to Pi model specs and errors with an allowed list when a slug is missing. A thinner provider list shrinks multi-model swarm/arena panels.

**Evidence.** design.md §2.9; poteto-mode Subagents section (Pi-rewritten); `src/task/models.ts`.

**Disposition.** Package-guaranteed behavior is slug parsing, `inherit-parent`/`auto`, and a clear allowed-list error. Cross-host model set equality is not a plugin artifact. Same class as image models. Not a missing pi-pstack feature.

### 5. Low. Local isolated workers are not remote sandboxes

**User notice.** `environment: "cloud"` still isolates into a git worktree on this machine. Uncommitted parent state and network reachability follow local rules, not a Cursor cloud VM.

**Evidence.** design.md §1 cloud→worktree mapping; `phase-a-frame.md` out-of-scope clause.

**Disposition.** Documented Pi substitute. Listed here only as residual user-visible difference for isolation strength. **Not** a Cursor-platform completion gate. Closure node `host-cloud-agent` is `cursor-platform-out-of-scope-with-pi-substitute`.

### 6. Low. Maintainer debt in Pi public APIs (not missing user features)

**User notice.** None if workarounds hold. Package reimplements four Pi 1.4.0 gaps (RPC subagent process, skill block format, `fork_turns` truncation, workspace slug).

**Evidence.** `extensions/pi-pstack/docs/native-gaps.md`.

**Why ranked low.** User-visible Task/mode/fork paths are implemented; risk is future Pi API drift, not a missing skill today.

## Explicitly excluded from this gap list (closure only)

| Item | Where it lives |
| --- | --- |
| Cursor Computer Use attempt IDs / enterprise org policy witnessing | `closure.md` `host-cloud-agent` / phase-a §7 |
| `docs/harness/claude-code.md` not shipped | `closure.md` `pstack-docs-harness-claude-code` |
| Skill `SKILL.md` byte inequality from Pi vocabulary rewrite | expected; `skill-matrix.tsv` notes; RES-012 bans Cursor host terms |
| Extra team-kit skills beyond poteto soft-deps | surplus vendoring, not a gap |
| Graphite `gt` | poteto forbids requiring it |
| Bugbot / Slack / Origin / `gh` as services | `external-service`; work via CLI/MCP on any host |

## Inventory non-gaps (measured closed)

- All 58 tip pstack skill dirs exist in pi-pstack.
- Soft-deps `deslop`, `control-cli`, `control-ui`: `SKILL.md` sha equal tip team-kit → pi.
- Tip agents, Benny automation paths, guide pages (except removed harness): present.
- poteto-mode and statechart script file counts match tip (18 and 405).
