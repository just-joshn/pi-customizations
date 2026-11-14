# Playbook: pi-claude-default-dark from the design pack

Source of truth, read verbatim: `/Users/josh-desktop/Documents/pi-claude-default-design-pack/`
(`DESIGN.md`, `README.md`, `PARITY_REPORT.md`, `reference-lock.json`, `token-crosswalk.csv`, `pi-claude-default-visual-mockups/`).
Section numbers below (§N) point into `DESIGN.md`. Decision trail: `decisions.tsv` beside this file.

## Goal

Build the Pi package that `DESIGN.md` specifies, exactly as specified, and run every gate G0 to G10 against the real pinned runtimes.
"Verbatim" includes the pack's own truth rule. The package ships with an honest `PARITY_REPORT.md`, and the release decision follows from the gate vector, not from effort spent.

## Frame

**Definition of done (falsifiable).** All of the following hold, each checked by a committed script:

1. `extensions/pi-claude-default-dark/` has the §5 tree. `package.json` equals the §5 manifest byte-for-byte in its keys and values.
2. `themes/claude-default-dark.json` has all 56 roles plus the 5 optional ones explicit, loads in Pi 1.5.2, and every hex value traces to a capture row or is labeled `pi-only`. The generator exits non-zero on any value without evidence.
3. `extensions/index.ts` implements `/claude-theme status` and `/claude-theme use` per the §6 sketch, typechecks against pinned 1.5.2 types, and imports nothing but host-provided modules.
4. Each gate G0 to G10 has a recorded verdict (PASS, FAIL, INCONCLUSIVE, with per-observation detail for G4). `PARITY_REPORT.md` and `reference-lock.json` are generated from those results, not hand-written.
5. The release decision is PASS only if every gate is PASS and zero comparable surfaces are uncovered. Otherwise it is BLOCKED and the report names each blocker.

**Grounding (measured 2026-11-13).**

- `claude --version` prints `2.1.322 (Claude Code)`. `pi --version` prints `1.5.2`. Both pins in `reference-lock.json` are installed here, so G0 is reachable. The pack's blocker 5 ("no installed Pi 1.5.2 / Claude 2.1.322") no longer holds on this machine.
- Pi 1.5.2's shipped `dark.json` has exactly the 56 role names in `token-crosswalk.csv` (sorted diff empty).
- `TERM=xterm-256color`, `COLORTERM=truecolor`, tmux 3.8 present. `TERM_PROGRAM` is unset, so the emulator, font, and ANSI16 palette are still unknown.
- The mockup PNGs say their colors are placeholders. They define the scene catalog only. No hex value is read from them.

**Scope.** About 16 units. Rough effort 8 to 12 agent-hours (guess). Riskiest unknown: whether Claude Code 2.1.322 runs against a local scripted Messages peer in a scratch config dir, so every scene is deterministic, offline, and secret-free.

**Rigor: high on evidence, low on architecture.** The output is a parity claim the pack defines as fail-closed, so every gate is a script with a baseline and an artifact, and a different model family judges each delegated unit. The architecture is already settled by §1, §5, and §11 (strategy A), so no architect or arena run for it. Arena runs only if G4 proves a renderer adapter is required (strategy B), since that touches public hooks with load-order and focus risk. The package is private and appearance-only, so blast radius is low and every unit is reversible.

## Decisions taken from the pack, and conflicts resolved

| Point | Pack text | Resolution |
|---|---|---|
| Entry path | §5 `extensions/index.ts` | Use it, though repo packages use `src/index.ts`. Verbatim wins. |
| Manifest | §5 `"dependencies": {}`, `files` lists runtime only | Keep the runtime manifest exact. Dev tooling (tests, scripts, typecheck) lives under `development/` with its own `package.json`. |
| `verify` subcommand | §5 lists `status`, `use`, `verify`; §6 and §12 say `status` + `use` only until diagnostics are real | Ship `status` + `use`. Add `verify` only if it can report evidence baked in at build time from the generated report. Open decision 2. |
| Pi-only roles | §1 "Pi-only scenes are documented as not having a Claude Code referent" | Default: keep stock Pi 1.5.2 dark value, labeled `pi-only`, never counted toward parity. Open decision 1. |
| Undocumented Claude values | §8.3 cite the capture, never invent a token | Crosswalk `claude_candidate_or_observation` cites `scene@frame:row,col` for those. |
| Binary string scan of the Claude executable | §2 third-party or reverse-engineered palettes are "candidate research only" | Allowed only as a cross-check. A disagreement with a capture is investigated, never used as a value. |
| Activation | §1 constraint 4, §6 step 4 | No `session_start` handler that sets a theme. G7 tests this. |
| Repo wiring | Not covered | Do not add the package to the root `pi` manifest. Add a `make verify-claude-default-dark` target. |

## Workflow

Each unit is an experiment: hypothesis, smallest change, measure on the real artifact, keep or revert, log a row. No unit starts until the previous one's check is green, except where marked parallel.

| # | Unit | Gate | Check that ends the unit |
|---|---|---|---|
| U0 | `development/scripts/lock.mjs` freezes versions, binary SHA-256s, `claude` theme preference, TERM/COLORTERM, size, locale, OS, emulator, font, fg/bg, ANSI16 into `development/reference-lock.json` | G0 | Script exits 0. Every remaining null is listed with a reason and marks G0 INCONCLUSIVE. |
| U1 | **Riskiest first.** Drive Claude Code 2.1.322 in tmux with `CLAUDE_CONFIG_DIR` scratch, `ANTHROPIC_BASE_URL` pointing at a local scripted Messages peer (reuse `.pi/skills/_shared` if it fits), synthetic key, theme `dark` | G0, G3 | One idle scene and one assistant reply captured with `tmux capture-pane -e -p`, 24-bit SGR present, zero non-loopback connections. Fallback if the peer path fails: stop and ask (a real account run is the user's call). |
| U2 | Same harness for stock Pi 1.5.2 `dark` on the same peer and transcript script | baseline | Pi baseline captures exist for the same scenes. This is the "old value" side. |
| U3 | Scene catalog from §8.2 and the nine mockups, scripted for both products: idle, prompt focus/unfocus, accent, user message, working frames at fixed indices, autocomplete, selection, scrollbar, Markdown set, success/warning/error, shell mode, tool queued/running/ok/fail, edit diff add/remove/context/intra-line, search match, wide Unicode, resize, fullscreen, theme-switch restore. Pi-only scenes labeled. Widths 40/80/120/200 | G3, G8 | Every scene captured twice with identical hashes (determinism). |
| U4 | Typed domain model from §4 plus an SGR parser that turns captures into `ReferenceObservation` rows | G4 harness | Vitest on fixture ANSI: fg vs bg direction, attributes, reset handling, wide chars. |
| U5 | Crosswalk filler: script writes `development/crosswalk.csv` (56 rows, same columns) from observations. `mapping_class` is measured, renderer-required, unmappable, or pi-only. No row is mapped from a name match alone | G3 | 56 unique rows. Every comparable row has `reference_rgb` with a capture pointer. Judge subagent spot-checks 10 rows against raw captures. |
| U6 | Offline generator emits `themes/claude-default-dark.json` (`$schema`, unique `name`, `appearance: "dark"`, `#rrggbb` only) | G2 | Pi 1.5.2 schema and loader accept it. Generator fails on an injected unevidenced value (negative test). |
| U7 | Parallel with U4 to U6. `extensions/index.ts` from the §6 sketch, plus `development/` typecheck against pinned 1.5.2 types | G1, G5 | Typecheck green. Static scan: no private Pi paths, no `fs`, `child_process`, `net`, `process.stdout`, no tools, no prompt hooks. |
| U8 | Capture Pi 1.5.2 with the theme on the U3 catalog. Comparator diffs per observation, exact RGB and attributes, geometry reported separately | G4 | Per-observation PASS/FAIL vector written. No averages. |
| U9 | Only if U8 shows renderer-required failures. Run arena on a public-hook adapter (§5 list). If no public hook can express it, mark unmappable and keep BLOCKED | G4, G5 | Failing G4 scene goes green with public hooks only, or the row is marked unmappable with the hook search as evidence. |
| U10 | Parallel worker. Stock vs themed Pi on the scripted peer: request bodies, tool calls, session JSONL equal after normalizing ids and times | G6 | Diff empty. |
| U11 | Parallel worker. `pi install`, select via `/settings` and `--use-theme`, `/reload` x5, resume, fork, `pi remove`. User's other theme survives a new session | G7 | Each step asserted in a script. No double registration after reloads. |
| U12 | Parallel worker. Widths, CJK, emoji, combining marks, resize, 256-color mode note. IME cannot be automated here, so it records INCONCLUSIVE unless the user tests it | G8 | Script verdicts per environment. |
| U13 | Parallel worker. Malformed theme fails clearly, name collision surfaced, `status` never claims parity | G9 | Negative tests green. |
| U14 | `development/scripts/report.mjs` regenerates `PARITY_REPORT.md` and `reference-lock.json` `test_results` from artifacts, with fixture SHA-256s | G10 | Rerunning it reproduces byte-identical files. |
| U15 | `README.md` (install, select, limits, the claim allowed and prohibited), `LICENSE`, Makefile target, a `verify-pi-claude-default-dark` skill per repo convention | all | `make verify-claude-default-dark` runs U4 to U14 checks from a clean checkout. |

**Fan-out.** U1 alone (riskiest). U2 and U7 in parallel after U1. U10 to U13 in parallel after U8, each in its own scratch agent dir and tmux socket, since they share no files. Workers use the `feature, refactoring` line (`openai/gpt-6.1-sol:low`). Judges use `judgment and prose` (`claude-subscription/claude-sonnet-5-5:medium`), a different family from the workers. U5 spot checks use `swarm workers` (`openai/gpt-6.1-terra:low`).

**Checkpoint.** One pause after U1, because its result decides whether the run is offline and deterministic or needs a real account.

## Open decisions for the user

1. Pi-only role values. Default: stock Pi 1.5.2 dark, labeled `pi-only`. The alternative is leaving the package BLOCKED until you supply values.
2. `verify` subcommand. Default: omit it, as §6 and §12 say. The alternative is a `verify` that prints the build-time gate vector.
3. If U1 cannot run Claude Code offline, may the capture run use your real Claude account with synthetic prompts?
4. Terminal emulator and font to pin for screenshots. tmux SGR captures do not depend on them, but G8 and the screenshot half of G10 do.

## Expected outcome (guess)

Shared roles such as `accent`, `text`, `success`, `error`, `warning` likely measure cleanly. Diff roles likely hit the §7 direction mismatch, and thinking, export, and scrollbar roles likely land as pi-only or unmappable. So the honest end state is probably a working package with most gates PASS and the release still BLOCKED on named surfaces. That is the pack's intended result when parity cannot be shown.
