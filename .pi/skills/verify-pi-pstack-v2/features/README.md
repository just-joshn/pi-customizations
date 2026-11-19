# pi-pstack-v2 verification map

This is the maintained source for user-facing verification. Read the relevant recipe before driving; a convenient entry point is not coverage for the others.

## Baseline preconditions

- Follow ../SKILL.md with Pi 1.5.2 and a new evidence directory.
- Scratch starts with an empty Git repository, no HEAD, no credentials, and no configured model.
- Offline discovery is usable immediately. All AI/tool journeys require owner-approved real login and an available model.
- Live tool journeys must run from an uncontained foreground launcher, not a Pi hosted inside a pstack job container.
- Use the helper's recorded absolute evidence/profile/workspace paths. Never drive an existing normal Pi session.
- Run doctor first; also check the actual UI and process before interacting.

## Driving conventions

- All terminal actions use `python3 "$HELPER" send "$EVIDENCE" TEXT`. Type text, capture/confirm the draft, then use `send EVIDENCE $'\r'` in a separate tool call to submit. Clear with `send EVIDENCE $'\025'` as a separate observed action; never combine clear, text and Enter in one burst.
- Capture before and after each action using the exact owned tmux socket/target. For an uncontained foreground launch retain terminal.ansi and native session JSONL; capture the owned terminal when available.
- Wait for a concrete label, tool result or file (20-second UI deadline; provider requests may need longer), never assume a key succeeded.
- Commands below are literal user requests to the model; require its actual tool events. A prose claim is not a tool result.
- IDs are returned by real calls. Stop only those IDs. Do not guess generated IDs.

## Proof and skip reporting

- Record action, resulting UI/tool event, and independent read-only observation of side effects.
- Preserve safe session/job evidence before cleanup; never copy credentials.
- Use feature/sub-feature IDs and entry points in result.md. Unattempted or blocked paths stay unverified.
- Offline discovery does not verify setup, workflow completion, real workers, or container isolation.
- If the seed lacks auth, a configured model, Git HEAD, or a remote, report the unmet precondition. Do not weaken the journey.

## Features

- [Workflow discovery](workflows.md): loaded resources, native command-menu discovery and safe dismissal.
- [Model-role setup](model-roles.md): setup-pstack, persistent role choices and reuse.
- [Shell job lifecycle](shell-jobs.md): start, list, output, wait, stop, wake and heartbeat.
- [Pi worker delegation](workers.md): standalone reports, roles, readonly, worktrees, resume and nesting.
- [Container write boundaries](sandbox.md): permitted workspace writes, denied outside writes and cwd restrictions.
