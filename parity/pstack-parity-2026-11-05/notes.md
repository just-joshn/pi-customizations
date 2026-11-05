# pstack parity run, 2026-11-05 (UTC)

Working notes for resuming this run. The decision trail is `decisions.tsv`. Raw evidence is in the ignored
`.audit/pstack-parity-2026-11-05/` directory.

## Baseline

- Reference: Cursor `pstack` 0.15.36 and `cursor-team-kit` 1.2.0 from `cursor/plugins` HEAD `bb68f2365eceafa0cb2d253112f675acf5f144cc`.
  The installed plugin cache `~/.cursor/plugins/cache/cursor-public/pstack/ae5650fe...` is byte-identical for all 573 pstack files (`.audit/.../reference/{up,inst}.sha`).
  `cursor-team-kit` is not installed in the local Cursor cache, so the upstream archive is its only source.
- Host: Cursor CLI `2026.10.22-27dcf5f` (`~/.local/share/cursor-agent/versions/2026.10.22-27dcf5f`). Cursor desktop is not installed.
  Built-in Cursor skills synced by the CLI are in `~/.cursor/skills-cursor/` (loop, canvas, create-skill, autopilot, origin, review-bugbot, ...).
  Official docs fetched as Markdown into `.audit/.../cursor-docs/` with `SHA256SUMS` and `RETRIEVED_AT`.
- Pi 1.5.0 at `~/.pi/agent/install/releases/1.5.0`. Node 24.13.1, Bun 1.4.4.
- Repository start: `982567b7`. Baseline gates: typecheck green, 731 tests passed and 5 skipped (`.audit/.../baseline-*.txt`).

## Evidence rules for this run

- No Cursor or Pi LLM sessions. Cursor behavior comes from the CLI bundle source, its protobuf schemas, the built-in skills,
  the official docs, and captures recorded by earlier runs (cited by path, marked as earlier captures).
- Pi behavior is observed through real Pi CLI or RPC runs with the deterministic `scripted` test model.

## Tree comparison

`tree-diff.mjs` maps reference files to pi-pstack paths. pstack: 499 identical, 70 changed, 4 absent (manifests,
`.gitignore`, `docs/harness/claude-code.md`). team-kit: 20 identical, 5 changed, 4 absent (manifest, avatar, two rules,
which pi-pstack carries as skills and injects as always-applied text). `host-references.mjs` maps each Cursor host
mechanism to the reference lines that rely on it.

## Findings

| ID | Finding | Evidence | Status |
| --- | --- | --- | --- |
| SKILL-REF-001..004 | Cursor attaches every `/skill` named anywhere in a submitted message (start or after whitespace), each once, in order. pi-pstack only expanded a leading `/name`. A leading prompt template must stay first for Pi to expand it. | `evidence/cursor-skill-references.json`, `evidence/cursor-submit-uses-skill-references.txt`, `skill-ref-baseline.txt`, `template-baseline.txt` | Fixed; unit, real-Pi e2e, mutation receipt `mutation-skill-ref.txt` |
| ASK-SKIP-001 | Cursor headless rejects AskQuestion with "Questions skipped by the user, continue with the information you already have"; its subagent runner with "Subagent cannot ask questions". | 8008.index.js headless.ts; 5622.index.js subagent runner; `ask-skip-baseline.txt` | Fixed |
| RULE-001 | The injected team-kit rule bodies carried headings the reference rules lack. | `rule-text-baseline.txt` | Fixed |
| LOOP-ABORT-001 | Cursor's local /loop is a background shell; the interactive CLI never aborts background work on a turn interrupt. pi-pstack stopped loops on Escape. | 8008.index.js `abortAllWork` call sites; built-in loop skill; `loop-abort-baseline.txt` | Fixed |
| EXPLORE-MODEL-001 | Cursor docs say explore uses a faster model by default. | `cursor-docs/docs_subagents.md`; `explore-model-baseline.txt` | Fixed |
| PLAN-CHECK | The port's read fallback for multi-phase plan boxes fails the unchanged `check-plan.mjs`. | `plan-fallback-check.txt` | Fixed (fallback removed) |
| MODE-NOTICE | Custom-mode notice texts match the CLI `custom-modes` module. | `evidence/cursor-skill-references.json` | Matches |
| AGENT-SHELL | team-kit names `subagent_type: "shell"`; the observed CLI lists no such type, so a Task with it fails in both hosts. | earlier capture `parity/pi-pstack-two/fixtures/cursor/cursor-subagent-types-and-models.json` | Recorded |
| TASK-RESUME | The CLI refuses a resume of a running subagent; pstack text and pi-pstack steer it. | 5622.index.js, index.js message constant | Recorded as host difference |
| PLAN-PRINT | Cursor headless auto-approves SwitchMode and returns CreatePlan success without a file; pi-pstack hides SwitchMode in print and JSON runs and writes the plan file. | 5622.index.js interaction-responses.ts | Recorded as host difference |
| HOSTED | Cloud VMs, hosted automations, Slack triggers, Projects, canvas, inline media, video input. | `host-dispositions.json` | Open gaps |
