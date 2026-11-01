# Coordinator summary: REA/pstack 0.15.36 dependency inventory

**User goal.** Make `extensions/pi-pstack` reach 100% parity with Cursor plugin `pstack` in a Pi-native way, with zero runtime dependency on the Cursor `pstack` plugin. This unit reverse-engineers tip pstack 0.15.36 and its dependency closure into evidence only.

**Playbook.** Investigation (read-only). Throughput checkpoint: n/a, read-only investigation.

**Principles applied.** Guard the Context Window (scripted inventories; did not load the 85 MB evidence bundle into the reply). Sequence verifiable units (matrix → closure → host map → gaps → verify files). Prove it works (sha counts and path existence measured on disk). Unslop (this report).

## Sources measured

| Source | Locator |
| --- | --- |
| Tip clone | `/tmp/cursor-plugins-rea` HEAD `ae5650febf4320793844c12c4adaa937f417f8da` (pstack trees still match lock `4dd1d05`; only unrelated lark-base advanced), `pstack` **0.15.36**. See `../rea-deps/refresh-ae5650f.md`. |
| Installed cache | `~/.cursor/plugins/cache/cursor-public/pstack/1ba91fc25c0977741dd0e267849e6234b037ed0a` (skill `SKILL.md` = tip 58/58) |
| Team-kit | tip `cursor-team-kit` **1.2.0** |
| Design | `parity/pi-pstack-0.15.36/design.md` |
| Package | `extensions/pi-pstack` `@justjoshn/pi-pstack@0.15.36-pi.3` |
| REA bundle | `parity/evidence/rea-pstack-0.15.36/evidence-bundle.json` (~85 MB; 2 artifacts, 4 records; summarized via keys + `phase-a-frame.md`) |

## Deliverables (this directory)

| File | Role |
| --- | --- |
| `closure.md` | Full dependency closure + every poteto soft-dep skill name |
| `skill-matrix.tsv` | 95 rows: tip skills/agents/automations/docs/assets + team-kit soft-deps + create-skill |
| `host-feature-map.md` | Cursor host features → Pi `src/` / substitutes; zero unmapped in-scope features |
| `gap-list.md` | Ranked user-visible gaps; Cursor-platform-only items excluded as required gates |
| `report.md` | This summary |

## Counts

| Metric | Value |
| --- | --- |
| Tip pstack skill dirs | 58 |
| Pi skill dirs | 79 |
| Tip→pi skill `SKILL.md` sha equal / differ | 38 / 20 |
| Tip agents / pi agents | 2 / 4 |
| Benny automation files (tip=pi path coverage) | 12 / 12 (all Pi-rewritten) |
| Guide doc files | 17 (+ harness intentionally omitted on Pi) |
| poteto soft-dep names enumerated | 6 (`deslop`, `control-cli`, `control-ui`, `create-skill`, `no-comments`, `benchmark-checklist`) |
| Team-kit soft-dep `SKILL.md` sha tip→pi | 3/3 equal |
| poteto-mode scripts files tip=pi | 18 (15 sha-equal) |
| statechart scripts files tip=pi | 405 (404 sha-equal) |
| skill-matrix.tsv data rows | 95 |
| Host features with no Pi substitute (in-scope) | 0 |
| Gap-list items framed as Cursor-platform-only required gates | 0 |

## Overview / how it works

pstack 0.15.36 is a skill/agent/automation/doc tree plus poteto-mode and statechart script packages. Soft runtime deps poteto names are three `cursor-team-kit` skills, Cursor's `create-skill`, and two first-party skills. Host behavior skills assume (`Task`, todos, ask, mode, plan, loop, subscriptions, routines, visualize, model rule, projects) is implemented under `extensions/pi-pstack/src` or substituted per `design.md`. External forges and bots (`gh`, Origin, Bugbot, Slack) stay outside the package.

## Key judgment

Inventory coverage for tip 0.15.36 and poteto soft-deps is **closed** in pi-pstack. The largest remaining user-visible parity risks are **routine durability with the Pi process**, **optional image generation**, and **create-skill guidance depth**, not missing skill paths or missing team-kit soft-dep bytes.

**Parity acceptance.** Not claimed. This unit only wrote evidence under `parity/evidence/rea-pstack-0.15.36/dependency-inventory/`.
