# Plan artifacts

Plan mode exposes `create_plan`, which writes a markdown `.plan.md` under Pi's agent `plans/` directory. The file carries a session header and YAML `todos` when present; `phases` imply a project plan. The interactive plan review can start Agent execution.

## Sub-features

- `create-plan-tool`: Plan mode offers `create_plan` and accepts a structured plan.
- `plan-file`: the tool writes `plans/<name>-<session-prefix>.plan.md`.
- `plan-todos`: todos are serialized into YAML frontmatter.
- `plan-phases`: phases are serialized and make the plan a project plan.
- `plan-review`: the Ready to build? flow can start, stay, or defer execution.

## How to get to it (user POV)

Use `/plan` or `--mode=plan`, ask the model for a plan, and have it call `create_plan` with a markdown body, name, todos, and optional phases. Pi prints the plan file path. Inspect the file at `$PI_CODING_AGENT_DIR/plans` or `$PI_MODES_PLANS_DIR` when set. The Ready to build? prompt appears after planning.

## Driving it with the Pi TUI

The fake-model e2e proves Plan guidance and that `create_plan` is offered, but does not force a plan write. Use a fresh TUI and a real model:

```sh
mkdir -p "$EVIDENCE/tui/agent" "$EVIDENCE/tui/work" "$EVIDENCE/tui/plans"
cd "$EVIDENCE/tui/work"
PI_CODING_AGENT_DIR="$EVIDENCE/tui/agent" \
PI_MODES_PLANS_DIR="$EVIDENCE/tui/plans" \
  pi -ne -e "$REPO/extensions/no-ceilings/pi-modes/src/index.ts" \
  -np -nc --no-themes --plan
```

Ask for a short project plan with two todos and two phases. Require the model to call `create_plan`, then inspect the file path it reports. Copy the plan file, the session transcript, and a pane capture into `$EVIDENCE/`. Require the body, the session header, `todos`, and `phases`; run the Ready to build? flow and check the chosen branch in the next user message.

## Gotchas

- The deterministic fake e2e only checks `ok /mode plan offers create_plan`; it does not prove a file write. Do not claim plan artifacts from that run.
- Plan mode is read-only. If `create_plan` is unavailable, report the unmet loadout rather than using a shell redirect.
- The derived filename uses a sanitized title and session prefix. A repeat with the same title can reuse the filename; inspect whether `created` is false.
- Phases imply a project plan even when `is_project` is omitted.
- A plan created before resume may not trigger the review prompt automatically; check the current behavior before claiming resume proof.
