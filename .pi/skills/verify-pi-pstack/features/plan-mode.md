# Plan mode

`/plan` switches the session to read-only research: tools that change code are refused, markdown files can still be written, and the model saves its plan with `CreatePlan`. After a plan is saved the user is asked whether to build it. `/plan off` restores the tools.

## Sub-features

- `plan-on`: `/plan` notifies `Plan mode on: read-only tools only. /plan off exits.` and sets the `pstack-plan` footer status.
- `plan-create`: `CreatePlan` writes `agent/pstack/plans/<name>-<8 hex>.plan.md` with a `<!-- id -->` line, YAML front matter of todos and `isProject`, then the plan body.
- `plan-readonly`: `write` of a `.md` succeeds; `edit` of `code.ts` is an error and the file is unchanged.
- `plan-build-dialog`: a select dialog offers `Yes, build locally` / `No, propose changes`.
- `plan-off`: `/plan off` notifies `Plan mode off: tools restored.` and clears the footer status.

## How to get to it (user POV)

- Type `/plan` or `/plan <task>` in the TUI; `/plan off` to exit; `/plan build` to start the saved plan.
- The model can ask to enter it with `SwitchMode`.

## Driving it with control-pstack

Preconditions:

- `doctor` passes. The drive writes `work/code.ts` itself.

Steps:

- **Run.** `./.pi/skills/verify-pi-pstack/bin/control-pstack drive plan-mode`.
- **Act.** RPC session: `/plan`; then one prompt scripting `CreatePlan {name:"Ship it", plan:"# Ship it\n\n- prove the file exists", todos:[{id:"prove",...}]}`, `write notes.md`, `edit code.ts`; answer the dialog `No, propose changes`; then `/plan off`.
- **Observe.**
  - `plan-on` notification and a non-empty `pstack-plan` status.
  - Tool results `[CreatePlan ok, write ok, edit error]`; `notes.md` exists; `code.ts` still `export {};`.
  - The plan file matches `plan-create` exactly.
  - The dialog options are `["Yes, build locally", "No, propose changes"]`.
  - `plan-off` notification; the last `pstack-plan` status has no text.
- **Proof.** `artifacts/verify-pi-pstack/plan-mode/`: `Ship it-<hex>.plan.md`, `rpc.events.jsonl`, `results.json`.

## Gotchas

- The build dialog arrives after the turn that saved the plan; answering it `Yes, build locally` starts a build turn, which this drive avoids.
- `/plan` is a command, so its RPC response is `disposition: "handled"` with no `agent_settled`.
- The `Yes` path, `/plan build`, re-saving a plan, and building in a cloud worker are covered only by `test/e2e/plan.e2e.test.ts`.
