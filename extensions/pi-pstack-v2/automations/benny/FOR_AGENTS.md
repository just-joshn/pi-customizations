# Benny automation pack (dormant by default)

Benny is an optional, dormant issue-triage and reproduction automation pack. Its `SKILL.md` files live under `automations/benny/skills/` and are **not** registered as Pi slash skills.

## Activation contract

1. Never enable or run Benny automatically. Only proceed when the operator explicitly asks to set up or enable Benny in a target repository.
2. Read [`skills/setup-benny/SKILL.md`](skills/setup-benny/SKILL.md) and follow every fail-closed gate before creating any automation.
3. Copy/merge this pack into `.pi/automations/benny/` in the target project without deleting unrelated files.
4. Verify the target pack, project settings, and Benny configuration are committed and all dependencies are verifiable before creating automations.
5. Benny opens **DRAFT PRs only** (`draftPrOnly: true`) and never merges or deploys. This intentionally differs from `poteto-mode`'s ready-PR rule.
