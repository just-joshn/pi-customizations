# u-journey-cmd-plugin-skills report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest Pi binding delta). Both hosts register skills and agents from the locked package after load. Cursor binds via `.cursor-plugin/plugin.json` `skills`/`agents`. Pi binds skills via `package.json` `pi.skills` and agents via extension `persona-agents` from `upstream/agents/`. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `ca0f3e61-9af8-434c-b2f2-a98d9823725f` |
| pi | `11c4b783-86f3-426a-a1eb-e2048792071e` |

Pair. `parity/evidence/plugin-skills/pair-plugin-skills-register-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`

Locked plugin.json digest. `sha256:7bc736c60985805f70465e044e5adc7028663f72a73deea7fa3e95e52d70dc8e` (matches requirement source). Manifest values `skills: "./skills/"`, `agents: "./agents/"`. On disk: 51 skill dirs, agents `comment-sicko.md` and `poteto-agent.md`. Revision `ccb5507cec1546dc88135c1139c811e6c59115ba`.

## Skills and agents registered on both hosts?

| Side | Skills | Agents | Evidence |
| --- | --- | --- | --- |
| cursor | **yes** | **yes** | Slash menus after `--plugin-dir` locked pstack. `/how`, `/poteto-mode`, `/poteto-help` on skills screens. `/subagent-poteto-agent` on agents screen (`screen-02`/`03`/`04`). |
| pi | **yes** | **yes** | Ready skill-conflict panel cites `extensions/pi-pstack/skills/tdd/SKILL.md`. `/how` as `[task]` autocomplete. `/subagents` lists `poteto-agent` and `comment-sicko` (`screen-00`/`02`/`03`). |

## How registration works (investigation)

### Overview

Cursor plugins declare component directories in `.cursor-plugin/plugin.json`. Locked pstack sets `skills` to `./skills/` and `agents` to `./agents/`. Loading the plugin with `cursor-agent --plugin-dir` registers those directories into the slash menu. Pi has no Cursor plugin.json load path for this requirement. The shipped `pi-pstack` package declares skill directories under `package.json` `pi.skills`, and the extension registers persona agents from `upstream/agents/`.

### Key concepts

- Manifest keys. Cursor `skills` / `agents` relative paths.
- Host registration surface. Cursor slash autocomplete. Pi skill-conflict paths, task autocomplete, `/subagents` preferences.
- Binding delta. Same product content, different host contracts.

### How it works

1. Cursor starts with `--plugin-dir` pointing at locked `parity/reference/cursor-plugins/pstack`.
2. The host reads `plugin.json`, binds `./skills/` and `./agents/`, and exposes skills as `/name` and agents as `/subagent-*` (plus display-name variants).
3. Pi starts with `PI_CODING_AGENT_DIR=/tmp/pi-ref-agent` whose settings `packages` include `extensions/pi-pstack`.
4. Pi discovers package skills from `pi.skills` (`./skills`, `./host/skills`). The conflict panel shows the package `skills/` path when a user skill wins.
5. Pi persona agents (`poteto-agent`, `comment-sicko`) appear under `/subagents`, not as Cursor-style `/subagent-*` slash commands.

### Where things live

- Locked Cursor plugin. `parity/reference/cursor-plugins/pstack/`
- Manifest. `parity/reference/cursor-plugins/pstack/.cursor-plugin/plugin.json`
- Pi package. `extensions/pi-pstack/package.json` (`pi.skills`), `extensions/pi-pstack/src/persona-agents.ts`, `extensions/pi-pstack/src/skills-map.ts`
- Capture lever. `parity/scripts/capture-plugin-skills-register.mjs`
- Evidence. `parity/evidence/plugin-skills/`

### Gotchas

- Capture also loads `cursor-team-kit`, so some `/subagent-*` rows (ci-watcher, thermo-nuclear) are not from pstack `agents/` alone. `/subagent-poteto-agent` is the pstack needle used here.
- Pi `enableSkillCommands` is false in the reference agent settings. Skills still show as `[task]` entries.
- `/pstack status` did not print a settled `N skills` line in this run (`statusSkillCount: null`). Skills registration still has independent PTY proof via the conflict path and `/how` task.
- Concurrent workers can mutate `~/.cursor/rules/pstack-models.mdc`. This capture pinned the locked digest for the Pi run.

## Commands run

1. Confirmed locked plugin.json digest and models.mdc digest.
2. Wrote `parity/evidence/plugin-skills/PLAYBOOK.md` and `parity/scripts/capture-plugin-skills-register.mjs`.
3. `node parity/scripts/capture-plugin-skills-register.mjs --cursor-only`
4. `node parity/scripts/capture-plugin-skills-register.mjs --pi-only` (after restoring locked models.mdc for the run)
5. Wrote pair JSON and this report.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Pi first attempt (`440c0686…`) lacked `/subagents` listing. Discarded for the pair. Kept `11c4b783…`.
3. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
4. Did not commit.

## Honest product gaps

1. **Pi binding delta.** Requirement source is Cursor `plugin.json` `skills`/`agents`. Pi does not read those keys. Skills bind through `package.json` `pi.skills`. Agents bind through extension code (`persona-agents` → `upstream/agents/`). `piBindings` on the requirement is still empty. Coordinator should decide whether to add explicit Pi bindings or keep the delta as a standing mismatch.
2. **Different UX for agents.** Cursor exposes plugin agents as `/subagent-*` slash entries. Pi exposes them in `/subagents` preferences (and as Task agent types), not as slash aliases matching Cursor spelling.
3. **Skills as tasks on Pi.** With `enableSkillCommands: false`, packaged workflows show as `[task]` autocomplete rather than Cursor skill slash chrome.

## Suggested follow-ups for the coordinator

1. Merge pair into `cmd-plugin-skills-register` / family-03 evidence when ready.
2. Either draft `piBindings` for package.json + persona-agents, or open a mismatch for the Cursor-manifest-only source locator.
3. Optional. Recapture `/pstack status` until the skill-count line settles, if status text is wanted as a second skills oracle.
