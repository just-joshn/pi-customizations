# Workflow discovery

Users find the bundled pstack workflows in Pi's loaded-resource list and native command-completion menu without needing a model request. Discovery is distinct from executing those workflows.

## Sub-features

- `workflow-loaded`: startup resources list the checkout's bundled workflows and extension.
- `workflow-poteto-menu`: poteto-help and poteto-mode appear with descriptions in command completion.
- `workflow-setup-menu`: setup-pstack appears with its model/role configuration description.
- `workflow-clear`: dismissing the draft returns to the editor without invoking a workflow.

## How to get to it (user POV)

- Start Pi and inspect `[Skills]` / `[Extensions]`; Ctrl+O reveals expanded startup resources when hidden.
- In the editor type `/skill:poteto-` and inspect command completion without submitting.
- In the editor type `/skill:setup-pstack` and inspect command completion without submitting.
- Clear the draft to return to the editor.

## Driving it with the PTY helper

Preconditions:

- The credential-free offline baseline is healthy; no model/login is needed.
- The owned pane is at least 170x60. Require no duplicate-skill or load warnings.

- **Loaded resources:** capture 01-ready.txt after readiness. Require `v1.5.2`, `[Skills]` with `poteto-help`, `poteto-mode`, `setup-pstack`, `[Extensions]` with `src`, and the scratch workspace footer. If early rendering was clipped before resize, type `/reload` with `send`, capture/confirm that draft, then send `$'\r'` in a separate call, wait for the reload result and capture again; do not count a clipped file as full readiness evidence.
- **Find workflows:** run `python3 "$HELPER" send "$EVIDENCE" '/skill:poteto-'`. Capture to 02-poteto-menu.txt; require both `skill:poteto-help` and `skill:poteto-mode` plus their descriptions. Neither workflow should execute.
- **Find setup:** run `python3 "$HELPER" send "$EVIDENCE" $'\025'`, observe the empty editor, then run `python3 "$HELPER" send "$EVIDENCE" '/skill:setup-pstack'`. Capture to 03-setup-menu.txt; require `skill:setup-pstack` and its model/role configuration description. Do not press Enter.
- **Return to editor:** run `python3 "$HELPER" send "$EVIDENCE" $'\025'`. Capture 04-cleared.txt; require command completion disappears and the scratch footer remains. Confirm no model-response/tool events or role configuration file were created from this navigation.

## Gotchas

- `No models available` and `unknown` in an empty profile are expected here, but block workflow execution.
- Command completion uses `skill:…` labels; there is no extension-specific `/pstack` command.
- Hidden principle/support skills are not all advertised; absence from completion alone is not a bug.
- Installing another pstack package creates name collisions; only the checkout extension/skills should load in the parent.
- This feature proves discovery only. `/skill:setup-pstack` execution belongs to model-roles.md. Delegation through `/skill:poteto-mode` belongs to workers.md. Real help responses and print-mode workflow invocation require additional live coverage; menu discovery does not prove them.
