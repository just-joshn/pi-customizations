# pi-modes verification map

This is the maintained user-path map for `@justjoshn/pi-modes`. Read the parent [skill](../SKILL.md) for launch, doctor, evidence, and cleanup. Variables `HELPER` and `EVIDENCE` are the absolute paths from that run.

## Baseline preconditions

- Native `pi` >=1.5.2, Node >=22.19, and the checkout's dependencies installed.
- Source loaded explicitly from `extensions/no-ceilings/pi-modes/src/index.ts`; no installed copy of the package.
- One fresh `verify.mjs init` evidence directory per journey; `doctor` reports `ready`.
- The automated journey uses the repository's fake OpenAI-compatible model and a throwaway agent profile, workspace, and sessions. It needs no credentials.
- A manual TUI journey uses a fresh `PI_CODING_AGENT_DIR` and workspace. Never drive the user's normal profile.
- Real-model journeys use the package's `test/e2e/verify-modes.mjs` only when a logged-in model is available; exit 77 is a skip, not a pass.

## Driving conventions

- Run `node "$HELPER" drive "$EVIDENCE"` once. Read the stable `ok` lines in `stdout.log`; do not infer a feature from the final `PASS` alone.
- The copied `e2e-root/` holds `workspace/`, `agent/`, `sessions/`, and the fixture skill. Inspect those files for side effects.
- For manual TUI steps, send literal text and capture the pane after each action. Wait for a concrete line, not a fixed sleep.
- Keep `result.md` outside `e2e-root/` so cleanup cannot touch it.

## Proof and failure reporting

- Record the feature ID and the entry point used. `Ask`, `Plan`, and `Debug` are separate entries; one does not prove another.
- The fake-model run proves mode plumbing and tool gating, not real-model prose or provider behavior.
- Blocked shell evidence must show the guard message **and** the untouched victim file. A guard-only unit result is supporting evidence.
- Custom-mode evidence must show the entered skill block, the later reminder, and the absence of a second full skill body.
- A missing fixture or model precondition is a failed/blocked journey with its reason in `result.md`, not permission to weaken the replay.

## Features

- [Execution modes and read-only shell](execution-modes.md): Ask/Plan guidance, read-only loadout, blocked mutating bash, Agent comparison.
- [Custom modes](custom-modes.md): skill-backed entry, sticky reminder, `/mode off`, appearance writes, one-message attachment.
- [Mode switching and persistence](switching-and-persistence.md): `switch_mode`, `/mode plan`, inline prompts, unknown mode, extension-triggered turn, resume.
- [Debug ingest](debug-ingest.md): `/debug` server, NDJSON POST, log file, `/logs`; manual TUI journey.
- [Plan artifacts](plan-artifacts.md): `create_plan`, `.plan.md` output, phases and todos; manual TUI journey.
