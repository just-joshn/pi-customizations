# u-journey-cmd-poteto-agent report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host deltas). Both hosts spawned a fresh `poteto-agent` Task (not `generalPurpose`), and each child loaded `poteto-mode` `SKILL.md` (Principles index included) before other work. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `3632cd35-dfe5-4cc4-9bd0-ebcf7d44d240` |
| pi | `6288c9b7-08ac-4b5f-850c-021446b26409` |

Pair. `parity/evidence/poteto-agent/pair-poteto-agent-read-skill-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc restored after Cursor mutation; Pi `ruleUnchanged: true`)

## SKILL.md before other work on both hosts?

| Side | poteto-agent spawn | generalPurpose substituted | SKILL.md before work | Principles covered |
| --- | --- | --- | --- | --- |
| cursor | **yes** (child `472f69d3…`) | **no** | **yes** | **yes** (inferred: unlimited Read of a file that contains `## Principles`; Cursor transcripts omit tool results) |
| pi | **yes** (`task` `agent_type: poteto-agent`, child `agent-afc76f98…`) | **no** | **yes** | **yes** (measured: Principles text in child transcript after skill read) |

Cursor measured. Settled screen names child `472f69d3…` as the marker writer. Child tool head is `Read ~/.claude/skills/poteto-mode/SKILL.md` (no `limit`) then later `Shell` writes `HELLO`. Parent `done.txt` = `poteto-agent`.

Pi measured. Parent session tool order `read`, `TodoWrite`, `task`, `bash`. Child first tool `read extensions/pi-pstack/skills/poteto-mode/SKILL.md` at `21:46:49Z`, then `bash` writes marker at `21:46:51Z`. Parent `done.txt` = `poteto-agent`.

Worker capture playbook. `parity/evidence/poteto-agent/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Wrote worker `PLAYBOOK.md`, fixture-app, then `parity/scripts/capture-poteto-agent-read-skill.mjs`.
4. `node parity/scripts/capture-poteto-agent-read-skill.mjs --cursor-only` (~97s).
5. Restored Cursor-mutated models.mdc to locked digest.
6. `node parity/scripts/capture-poteto-agent-read-skill.mjs --pi-only` (~37s).
7. Re-read screens, Cursor child `472f69d3…`, Pi session + `subagents/agent-afc76f98…` tool order.
8. Patched Pi subagent path discovery in the capture script for the UUID/`subagents` layout.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Cursor parent mutated `arena runners` in `pstack-models.mdc` during the run. Worker restored the locked digest afterward. Recorded as a host delta, not hidden.
3. Initial automated Cursor child picker matched unrelated poteto-agent transcripts. Pair uses the settled-screen child id `472f69d3…` that wrote the marker.
4. Initial Pi observations missed the child because subagents live under `<uuid>/subagents/`, not beside the timestamped parent jsonl. Manual score + script patch.
5. PTY `generalPurpose` chrome hits are from the prompt phrase "do not substitute generalPurpose", not a real substitution.
6. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or family stubs.
7. Did not commit.

## Honest product gaps

1. Skill path differs by host (user-global `~/.claude/skills/…` on Cursor vs package `extensions/pi-pstack/skills/…` on Pi). Behavior matches; install location does not.
2. Cursor `/poteto-mode` parent can mutate `pstack-models.mdc` as a side effect of playbook work even when the held-out task forbids ledger edits. Worth a coordinator note if rule immutability is part of journey hygiene.
3. Cursor agent-transcripts store tool calls without tool results, so Principles-index coverage on Cursor is inferred from an unlimited Read of the skill file rather than retained body text. Pi retains the skill body in the child transcript.
4. No remaining spawn gap for `poteto-agent` on Pi after the persona bridge (unlike the earlier Comment Sicko miss).

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 / `cmd-poteto-agent-read-skill` evidence when ready. Close `PSTACK-CMD-POTETO-AGENT-READ-SKILL-001` when oracle freeze allows.
2. Optionally harden the capture scorer to require the marker-writing child id (Cursor) and UUID `subagents/` path (Pi) so automated `passShaped` matches the manual re-read.
