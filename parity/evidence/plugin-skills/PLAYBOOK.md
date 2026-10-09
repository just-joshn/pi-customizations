# Plugin skills register capture playbook

Requirement. `PSTACK-CMD-PLUGIN-SKILLS-REGISTER-001`
Scenario. `cmd-plugin-skills-register`

## Goal

Prove both hosts bind skills and agents directories after loading the locked pstack package, or record an honest Pi binding delta when the Cursor `plugin.json` keys are not the Pi path.

## Oracle

Cursor. After `--plugin-dir` load of locked `parity/reference/cursor-plugins/pstack` (rev `ccb5507…`), the slash menu must show skills from `./skills/` (for example `/how`, `/poteto-mode`) and agents from `./agents/` (for example `/subagent-poteto-agent`, `/subagent-comment-sicko`).

Pi. Package `extensions/pi-pstack` is loaded via `PI_CODING_AGENT_DIR` settings packages. Observe skills via `/pstack status` skill count (reads `skills/` + `host/skills/`) and optional skill activation chrome. Observe agents only if a real host surface lists them; otherwise record the binding delta (agents wired in extension code from `upstream/agents/`, not Cursor `plugin.json`).

## Steps

1. Confirm locked plugin manifest digest and on-disk `skills/` + `agents/` dirs.
2. Run `parity/scripts/capture-plugin-skills-register.mjs` for Cursor, then Pi.
3. Score screens for skills and agents needles. Write pair JSON + report. No ledger edits. No commit.
