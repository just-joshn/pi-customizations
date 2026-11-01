# Phase B workflow — close ranked gaps

Built from `dependency-inventory/gap-list.md` after inventory closed tip 0.15.36.

## Units (riskiest unknown first, then harness)

1. **Harness first (scaffold).** Script that re-checks Phase A inventory predicates (58 tip skills present, soft-deps present, no upstream-sync machinery, host tools registered). Baseline from current tree. Verify: script exit 0 on current package.
2. **create-skill depth.** Expand `extensions/pi-pstack/skills/create-skill/SKILL.md` to cover the Cursor builtin interview and structure guidance, rewritten for Pi paths per `design.md`. Verify: size/section coverage vs `~/.cursor/skills-cursor/create-skill/SKILL.md`; package resource tests still pass; no Cursor host terms (RES-012).
3. **Durable routines supervisor.** One-way door. Design then implement a Pi-native process that keeps webhook + timer subscriptions alive after the interactive chat exits (detached daemon or equivalent), restoring from persisted subscription state. Verify: arm timer/webhook, exit chat process, prove wake still fires; tests for restore path.
4. **Image generation path.** Make the ketchup/visual path either work when Pi has an image model configured, or fail closed with the documented Mermaid substitute and a package-level check that names the config. Verify: section text + test asserting the substitute contract.
5. **Catalog diversity.** Document-only unless a package lever exists: setup-pstack already lists available models. Verify: no false claim of cross-host model sets.

## Fan-out

- Units 1–2 and 4 are independent after harness lands; own separate files.
- Unit 3 gets architect/how before code; sole writer of subscriptions daemon paths.
- No shared branch writers.

## Out of Phase B product scope

Cursor CU cloud attempt IDs, Enterprise org policy witnessing, Claude Code harness doc, remote cloud VMs (local worktrees remain the substitute).
