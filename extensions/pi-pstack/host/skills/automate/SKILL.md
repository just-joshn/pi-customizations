---
name: automate
description: Create a reviewed, disabled Pi automation draft through the Automations editor handoff. Use when the user explicitly asks to create a first-time automation such as benny-triage. Creation only. Does not enable.
disable-model-invocation: true
---

# Create a disabled automation draft

Finish first-time automation creation only through this skill's reviewed Automations editor handoff. Persist a local disabled draft. Do not call Cursor Automations backends. Do not open a draft-field browser URL or protocol deep link. Do not enable before thread-safety. Do not post to Slack during creation. This skill is unrelated to `automate-me`.

Webhook button routines stay on `/make-bot-ui` and `Routine*` tools. Do not reuse `RoutineEnable` for Slack automations.

## Creation steps

1. Confirm the user explicitly asked to create the automation. Refuse otherwise.
2. Confirm any operational pack or config path is committed before drafting. Fail closed if it is not.
3. Call `AutomationPrepare` with `name`, `description`, `instructions`, optional `operationalPath`, `trigger`, and `tools`. For Benny Slack triage use `trigger.type = slack.top_level` with the authorized channel id. Preparation writes a disabled draft only. No ingress starts.
4. Present the returned draft as a table (name, trigger, tools, revision, kind=disabled). Obtain operator approval with `ctx.ui.confirm` when UI is available.
5. Confirm readiness, then call `AutomationOpenEditor` with the `automationId`. Pi TUI opens the Automations editor chrome (`ctx.ui.custom`, marker `pi-automations-editor-v1`). The title is the automation name and the state is Inactive. Operator Save persists through the same disabled `saveAutomation` path as `AutomationSave` and returns the edited definition. Cancel leaves the draft disabled and does not write editor edits.
6. If OpenEditor returned `opened=false`, stop. If `opened=true`, the disabled draft is already persisted. Optional `AutomationInspect` to confirm. `AutomationSave` remains available for non-editor revisions of the same draft. Save always keeps `kind=disabled` and never starts Slack or webhook ingress.
7. Do not call `AutomationEnable` from this creation skill. Enable refuses without a matching `thread-safety.json` receipt for the exact revision and without interactive confirm.

## Thread-safety receipt (after editor save)

Only after the operator has run the seven thread-safety checks on a test channel or harmless report:

1. Call `AutomationRecordThreadSafety` with the current `automationId`, exact `revision`, and all seven checks set to `true`.
2. Do not call `AutomationEnable` from this creation skill. A separate operator-approved enable (receipt + confirm) may mark the draft enabled locally; it still does not start Slack ingress.

Changing name, instructions, trigger, or tools after save requires a new prepare or a save with the current revision as the expected baseline. Installation of this skill alone does not authorize creation or enablement.
