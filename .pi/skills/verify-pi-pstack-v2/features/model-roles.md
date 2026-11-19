# Model-role setup

Users run setup-pstack to choose models and thinking budgets for pstack roles. Choices persist in their Pi profile and influence later workflow instructions.

## Sub-features

- `roles-setup`: available-model detection and role/budget choices.
- `roles-persist`: pstack-v2-models.md is saved under the isolated agent directory.
- `roles-reuse`: a later session sees the chosen role lines.

## How to get to it (user POV)

- Submit `/skill:setup-pstack` in Pi.
- Edit the documented `pstack-v2-models.md` in the Pi agent directory directly.
- Run a workflow such as `/skill:poteto-mode` after configuring roles.

## Driving it with the PTY helper

Preconditions:

- Owner-approved login through a built-in provider, real model selected.
- Empty baseline has no available models: report the setup journey blocked rather than inventing provider/model IDs.

- **Configure:** run `python3 "$HELPER" send "$EVIDENCE" $'/skill:setup-pstack'`. Answer its model/budget questions using only available models and the actual offered choices: the budgets are `large (xhigh thinking)`, `medium (high thinking)`, and `small (medium thinking)`, followed by a confirmation. Record each answer (never credentials).
- **Persist:** read scratch `agent/pstack-v2-models.md` independently. Save a safe copy to evidence; require `# defaults: 3`, `# budget: <name> (<level>)`, and role lines containing the selected provider/model and thinking level. Verify no file was written into the user's normal Pi directory.
- **Direct edit entry:** in scratch only, change the chosen role line to another actually available model/budget. Preserve before/after copies.
- **Reuse:** quit and relaunch the same scratch profile, then submit `Which model and thinking budget does my pstack role configuration assign to feature work? Do not edit files or run jobs.` Require the answer to match the persisted lines; retain session output and file evidence. This observes behavior, not the full hidden system prompt.
- **Workflow use:** start a small poteto-mode task and inspect the actual `subagent` call: its `model` (top level, `tasks[i]`, or `chain[i]`) must equal the role's model, and `thinking` must be set, matching the role's level or a stated adjustment. A call with a model and no `thinking` runs the worker at the model's own default level. The result's usage line names the model the worker ran on. Do not infer tool arguments solely from the assistant's explanation.
- **No role line:** change the role to `inherit-parent` in scratch and repeat a small task; require the `subagent` call to omit `model`, so the worker runs on the session model.

## Gotchas

- setup-pstack is a skill that needs a model, not a deterministic settings dialog.
- The extension injects the role file into model instructions; reading it back is weaker evidence than observing the workflow's actual worker arguments.
- Do not copy the user's normal role file as seed data and then call its existence setup proof.
- A cold restart and a later workflow call are distinct from successful file creation.
