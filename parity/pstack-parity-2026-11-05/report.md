# pstack parity run, 2026-11-05 (UTC)

## Goal and verdict

The goal is behavioral parity between pi-pstack and Cursor's pstack plugin, including what pstack gets from cursor-team-kit and from the Cursor host.

`NOT VERIFIED`. This run closes ten divergences and proves the result through Pi's real entry points. Seven host mechanisms have no Pi runtime (cloud VMs, hosted automations and their Slack trigger, hosted subscriptions, Projects, the in-app browser and canvas, inline media, and video input to models). One reference contract is unknown (`/visualize`). Those rows stay open in the inventory, so whole-plugin parity is not established.

The run used no subagents and started no Cursor or Pi model session. Cursor behavior comes from the CLI bundle, its protobuf schemas, Cursor's built-in skills, and Cursor's docs. Pi behavior comes from the Pi CLI and RPC with the deterministic scripted test model.

## 1. Reference baseline

| Item | Identity |
| --- | --- |
| pstack | 0.15.36, `cursor/plugins` HEAD `bb68f2365eceafa0cb2d253112f675acf5f144cc`. The installed cache `~/.cursor/plugins/cache/cursor-public/pstack/ae5650fe...` is byte-identical for all 573 files. |
| cursor-team-kit | 1.2.0 at the same revision. Not installed in the local Cursor cache. |
| Cursor CLI | 2026.10.22-27dcf5f. File hashes for `index.js`, `5622.index.js`, and `8008.index.js` are in `.audit/pstack-parity-2026-11-05/evidence/cursor-cli-file-hashes.txt`. |
| Cursor built-in skills | `~/.cursor/skills-cursor/` (loop, canvas, create-skill, autopilot, origin, review-bugbot, and others). |
| Cursor docs | Markdown pages fetched into `.audit/pstack-parity-2026-11-05/cursor-docs/` with `SHA256SUMS` and `RETRIEVED_AT`. |
| Pi | 1.5.0, installed at `~/.pi/agent/install/releases/1.5.0`. |
| Repository start | `982567b7`. Baseline gates passed (731 tests, 5 skipped). |

Cursor desktop is not installed, so desktop and hosted behavior comes only from source and docs.

## 2. Behavioral specification

`inventory.md` and `inventory.json` hold 133 rows with stable IDs and all 17 specification fields. They cover 76 skills, 4 agents, 2 rules, 12 Benny automation files, 7 scripts, and 32 host mechanisms. Skill, agent, rule, and automation rows name their source file and sha256. Every row names its Pi equivalent, its divergence when there is one, its evidence, and its status. `rebuild.sh` regenerates them from a `cursor/plugins` checkout.

Supporting artifacts:

- `tree-diff.mjs` maps every reference file to the package. pstack has 499 identical, 70 changed, and 4 absent files (two manifests, `.gitignore`, and the Claude Code adapter). team-kit has 20 identical, 5 changed, and 4 absent files (manifest, avatar, and two rules that pi-pstack carries as skills and injects verbatim).
- `classify-adaptations.mjs` splits the 75 changed files into 346 hunks and labels each by the Cursor-specific text it removes. `review-verdicts.tsv` records a verdict for each of the 138 hunks the labels could not explain.
- `host-references.mjs` maps each host mechanism to the reference lines that use it.
- `link-check.mjs` confirms that every relative link and skill name in the shipped text resolves inside the package.

## 3. Architecture

pi-pstack ships pstack's and team-kit's text as Pi package skills and agent files, and one extension that supplies the host mechanisms the text names. The table maps the mechanisms this run changed. `docs/parity-status.md` in the package maps the rest.

| Cursor mechanism | Pi-native equivalent |
| --- | --- |
| `findSkillReferences` attaches every `/name` in a submitted message | An `input` handler. The first skill rides Pi's `/skill:name` expansion and each further skill is a block ahead of the message. |
| Custom-mode notices and the attached skill | `/mode`, with the CLI's notice texts and the skill in a system-prompt section on every request. |
| Headless and subagent AskQuestion rejection | The same reject reasons when nobody can answer. |
| Always-applied plugin rules | Rule bodies injected verbatim into the host section. |
| `/loop` as a background shell loop | A native `/loop` command and `Loop` tool whose loops survive an interrupted run. |
| Built-in explore on a faster model | `explore` defaults to Pi's `fast` alias, the parent's `-fast` variant when listed. |

## 4. Implementation

| Change | Paths |
| --- | --- |
| Attach every skill a message names, each once, in order, and expand a leading prompt template when skills are also referenced. | `extensions/pi-pstack/src/aliases.ts`, `src/autocomplete.ts`, `src/index.ts`, new `src/skill-block.ts`, `src/mode.ts` |
| Accept Cursor's `reasoning`, `reasoning_effort`, `effort=none`, and `speed=fast\|default` model parameters, and honor `permissionMode: readonly` and `background: true` in agent frontmatter. | `src/task/models.ts`, `src/task/agents.ts` |
| Re-open the existing plan review dialog on a bare `/plan` when a plan is saved, and detect zombies and pre-epoch supervisor locks on macOS as well as Linux. | `src/plan.ts`, `src/process-lock.ts`, `src/subscriptions/durable-store.ts` |
| Return Cursor's AskQuestion reject reasons when nobody can answer. | `src/ask.ts` |
| Inject the team-kit rule bodies exactly. | `skills/no-inline-imports/SKILL.md`, `skills/typescript-exhaustive-switch/SKILL.md` |
| Keep a loop running after an interrupted run. | `src/loop.ts` |
| Run `explore` on the parent's `-fast` variant. | `src/task/agents.ts` |
| Remove the multi-phase plan fallback that `check-plan.mjs` rejects. | `skills/poteto-mode/playbooks/multi-phase-plan.md` |
| Tests, README, parity status, changelog, version `0.15.36-pi.17`. | `test/`, `README.md`, `docs/parity-status.md`, `CHANGELOG.md`, `package.json`, `bun.lock` |

## 5. Verification

Receipts under `.audit/pstack-parity-2026-11-05/` are local and git-ignored, as in earlier runs. `rebuild.sh` regenerates the comparison artifacts, and the package tests regenerate the behavior checks.

| Check | Result | Receipt |
| --- | --- | --- |
| Failing tests before each fix | The test for each code fix failed on the old code. The plan fix has a checker receipt instead of a test. | `.audit/pstack-parity-2026-11-05/*-baseline.txt`, `plan-fallback-check.txt` |
| Mutation of the reference regex | Anchoring the regex to the message start failed 10 tests. All 37 passed after restoring it. | `mutation-skill-ref.txt` |
| All 79 skills attach through `/name` in one real Pi session | Passed. | `test/e2e/skills-catalog.e2e.test.ts` |
| One real Pi session with a mode, a referenced skill, a background `poteto-agent`, `TodoWrite`, the completion notice, and the mode reminder | Passed. | `test/e2e/workflow.e2e.test.ts` |
| Statechart suite from the package with TLC | 367 of 367 passed. A TLC chart run reproduced the corpus `chart.mmd` and `report.md`. | `statechart-tests-with-tlc.txt` |
| `control-pi` doctor and drives | Passed. | `drive-commands/`, `drive-mode/` |
| Root `make verify` under Node 26.13.0 | Passed. pi-pstack had 747 passing and 5 skipped tests (baseline 731). | `make-verify-node26-final.txt` |

## 6. Independent review

All three passes were done by the same assistant with deterministic checks, because the operator forbade other agents. No cross-model review was run.

- **Verify.** The gates above ran on the final code. `biome ci`, the test-convention checker, and the package typecheck passed.
- **Confirm.** The run walked the reference again from Cursor's side. That walk found the `check-plan.mjs` contradiction in the multi-phase plan, the missing exact rule text, and the explore model default. The catalog and workflow tests exercise the package through Pi's real entry points.
- **Fact-check.** The run tried to break its own changes. It found that the new skill-reference transform broke a leading prompt template, because Pi expands templates after input handlers. The run fixed that and recorded the limit. It also checked that webhook and notification wakes use custom messages, so untrusted payloads never reach the reference scan.

## 7. Remaining gaps

| Gap | Class | Evidence |
| --- | --- | --- |
| Cloud subagents on a VM that runs with the laptop closed | Runtime limitation | `docs_subagents.md` Cloud subagents. Pi has no hosted agent runtime. Docker is installed but its daemon was not running, and OpenShell is absent. |
| Hosted Automations, the Slack trigger, `/automate`, routine URLs, `update_state`, `SendToUser` | Runtime limitation and missing access | `docs_cloud-agent_automations.md`. No Slack workspace or hosted trigger was available. |
| Hosted subscriptions, Origin CI, Slack channel listening | Runtime limitation and missing access | Built-in loop skill, `docs_agent_projects.md`. Origin is not installed. |
| Projects with a cloud coordinator and synced context | Runtime limitation | `docs_agent_projects.md` |
| In-app browser and Canvas | Runtime limitation | Built-in canvas skill |
| Inline screenshots and video in replies; video input to subagents | Runtime limitation | Pi chat and Pi models |
| `/visualize` | Unverified, reference contract unknown | Not in the CLI bundle or the fetched docs |
| Approval gates (run modes, GenerateImage decision) | Out of scope, host policy | pstack text does not depend on them |

Smaller host differences that do not change pstack's instructions are listed per row in `inventory.md`.

## 8. Final verdict

`NOT VERIFIED`. Every implementable divergence this run found is fixed and verified through Pi's real entry points. The gaps in section 7 need a hosted runtime, external accounts, or a reference contract that this host does not provide.
