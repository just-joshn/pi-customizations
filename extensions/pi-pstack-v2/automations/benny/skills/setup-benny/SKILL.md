---
name: setup-benny
description: Dormant setup workflow for copying, configuring, validating, and enabling the Benny triage and reproduce automations in a target repository. Not a registered slash skill.
---

# Setup Benny

Fail closed at every gate. Never enable an automation or post to any channel until every prerequisite below is verified.

## Preflight gates

1. **Copy pack safely.** Copy/merge `automations/benny/` into `.pi/automations/benny/` in the target repository. Never delete unrelated files.
2. **Project pstack enabled.** Confirm `pi-pstack-v2` is enabled for the project (`.pi/settings.json` or installed Pi package config). If missing, stop and fail closed.
3. **Complete configuration.** Verify all required config fields are present and non-placeholder:
   - Source channel coordinates
   - Issue tracker configuration
   - App control adapter (for example `control-ui`) and mapped feature map
   - Models and execution budgets
   If any item is incomplete, fail closed and do not enable or post.
4. **Committed and verifiable.** Confirm the copied pack, project settings, and Benny config are committed on the repository branch and all referenced dependencies resolve.
5. **Explicit operator approval.** Confirm the user explicitly requested automation creation. Without explicit approval, stop.

## Creation or validation

- **First-time creation.** Use `/automate create benny-triage` first and complete the review/editor handoff. Only after `benny-triage` is in place, run `/automate create benny-reproduce` second and complete its review/editor handoff.
- **Existing automation.** Do not overwrite existing manifests. Run `/automate status benny-triage` and `/automate status benny-reproduce` to validate config and give the operator a concrete editor checklist.
