# HOW-WORKFLOW-EXPLAINER-STEP disposition

Status. Open finding. This note names the comparison method. It does not assign pass or fail for `PSTACK-PLAYBOOK-HOW-001`.

throughput checkpoint: n/a, read-only investigation

## Question for the coordinator

Which falsifiable comparison method binds this fixture before any repair?

| Method | Claim | Pass signal | Fail / retain signal |
| --- | --- | --- | --- |
| A. Deterministic spawn required | For `how:investigation-question`, Step 2b is mandatory when Task exists | Parent turn starts one explainer Task (or equivalent "Running subagent" / Task UI) before the final answer | Parent finishes with direct tools only and never starts an explainer Task |
| B. Model-choice variance with retention | Spawn is preferred prose, not a hard gate; score the answer contract | Read-only held, rule digest unchanged, grounded answer present | Same retention criteria unmet, or a later flip forces method re-pick |

Recommendation (measured evidence, not a parity verdict). Prefer Method A for this fixture. Skill text is imperative. Reference runs spawn 2/2. Candidate skips after skill-body delivery. Candidate `Task` exists in `extensions/pi-pstack/src/workers.ts`. More reference runs are not required before the coordinator may adopt Method A and authorize a repair lever.

## Exact skill text

Official lock (`parity/reference/cursor-plugins/pstack/skills/how/SKILL.md`):

```text
## Step 2b. Direct Explain (simple questions)

Spawn one Task subagent that explores and explains in one pass:

- `subagent_type`: `generalPurpose`
- `model`: the `how explainer` line, default `claude-opus-5-5-xhigh`
- `readonly`: `true`

Build its prompt from `references/explainer-prompt.md` without the explorer-findings section. Go to Step 4.
```

Candidate skill (`extensions/pi-pstack/skills/how/SKILL.md`) uses the same Step 2b imperative ("Spawn one Task subagent that explores and explains in one pass") with the same `generalPurpose` / `how explainer` / `readonly: true` bullets. The candidate adds explainer-prompt cleanup lines for the no-explorer case. That does not license skipping the spawn.

Related Step 1 line in both skills:

```text
When in doubt, take the simple path.
```

That line chooses simple versus complex (2b versus 2a). It does not authorize answering inline instead of Step 2b.

## Investigate attempt IDs

Fixture (both pairs). `how:investigation-question`, question `how does the pstack budget line in models.mdc change agent behavior?`, fixture digest `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`.

| Side | Attempt ID | Pair / note | Spawn? | Observable evidence |
| --- | --- | --- | --- | --- |
| cursor | `dfe89f1a-a5a9-4837-ac17-0b21ba5ee462` | `pair-investigate-1.json` | yes | Announces "per the /how workflow I'll spawn a single explainer (role how explainer → inherit-parent)"; shows "Running subagent"; later presents "Overview" |
| cursor | `6f45e2db-c821-4663-bc85-ac9a01fc76e8` | `pair-investigate-2.json` | yes | Announces "simple path: one explainer subagent, no explorers"; shows "Running subagent" |
| pi | `05056781-f5a2-4f64-8480-9748deee5686` | `pair-investigate-1.json` (pre delivery repair) | no | Answers without Task; states it worked "without spawning explorer or explainer subagents" |
| pi | `03252b53-a395-476d-86c2-a7636c4c4116` | `pair-investigate-2.json` (post delivery repair) | no | Stream carries how-body fragments including "without the explorer-findings section. Drop the sentence..."; final text "I read the code directly instead of spawning explorers..." |
| pi | `8ad2dbc5-5ffa-48e3-8b76-0f6de82f6219` | chip follow-up after `expand()` | no | Shows `[skill] how (ctrl+o to expand)`; final text "I did this with a few greps instead of spawning explainer agents..." |
| pi | `71003cfe-3806-4276-8dab-438f304c23c2` | supplemental under `evidence/investigate/pi/` | no | Also skips spawn; not part of the paired investigate-1/2 ledger rows |

Delivery context (closed elsewhere). `HOW-SKILL-DELIVERY-MODE` is closed on investigate-2. `investigate-parity.json` records pi user-message delivery of the how body including Step 2b. This disposition treats delivery as ruled out and does not reopen it.

Ledger summary already on file. Reference 2/2 spawn (`dfe89f1a`, `6f45e2db`). Candidate skips on the three IDs named in `parity/mismatches.json` (`05056781`, `03252b53`, `8ad2dbc5`). Post-delivery confirmed body path is at least `03252b53` and `8ad2dbc5`.

## Method A details (deterministic spawn required)

Falsifiable check on a settled attempt dir.

1. Decode PTY `events.jsonl` (or host Task receipts if present).
2. Pass if the parent turn starts an explainer delegation before the final user-visible answer (Task tool call, "Running subagent", or equivalent Task chrome).
3. Fail if the parent answers with only direct tools (bash/rg/read) and never starts that delegation.
4. Out of scope for this check. Answer quality, section headings, latency, and chip wording.

More reference runs before repair under Method A. Not required. Existing 2/2 already supports adopting the method. Optional confidence protocol if the coordinator wants N=3 before arming a product repair:

- Fixture. Same capture driver and digest as `pair-investigate-2.json` (`parity/scripts/capture-investigate.mjs`, digest above).
- N. One additional cursor-only run (total reference N=3).
- Stop rule. If that run skips Step 2b spawn, abandon Method A for this fixture and switch to Method B retention. If it spawns, Method A stays.

Repair levers remain the ones already listed on the open mismatch (enforcement, answer-contract rubric, or model-role change). Choosing Method A does not by itself pass or fail the requirement.

## Method B details (model-choice variance with retention)

Falsifiable check.

1. Keep every attempt directory under `parity/evidence/investigate/{cursor,pi}/<attemptId>/`.
2. Require at least two reference and two post-delivery candidate attempts on the same fixture digest before closing the finding as host/model variance.
3. Score only the answer contract. Skill activated, read-only held, rule digest unchanged, grounded answer present. Do not require Task spawn.
4. Stop rule. If any later reference run skips spawn, or any later post-delivery candidate run spawns, reopen the method choice. Do not close from one more identical candidate skip alone (matches current `mismatches.json` nextAction).

More reference runs before repair under Method B. No product repair is implied. No further reference runs are required to keep the finding open under retention.

## What this disposition does not decide

- No parity pass/fail for `PSTACK-PLAYBOOK-HOW-001` or HOW-WORKFLOW-EXPLAINER-STEP.
- No close/edit of `parity/mismatches.json`.
- No choice among enforcement versus rubric versus model-role repair. That follows after the coordinator locks Method A or B.

## Paths cited

- `parity/mismatches.json` (open HOW-WORKFLOW-EXPLAINER-STEP)
- `parity/evidence/investigate/investigate-parity.json`
- `parity/evidence/investigate/pair-investigate-1.json`
- `parity/evidence/investigate/pair-investigate-2.json`
- `parity/evidence/investigate/cursor/dfe89f1a-a5a9-4837-ac17-0b21ba5ee462/`
- `parity/evidence/investigate/cursor/6f45e2db-c821-4663-bc85-ac9a01fc76e8/`
- `parity/evidence/investigate/pi/05056781-f5a2-4f64-8480-9748deee5686/`
- `parity/evidence/investigate/pi/03252b53-a395-476d-86c2-a7636c4c4116/`
- `parity/evidence/investigate/pi/8ad2dbc5-5ffa-48e3-8b76-0f6de82f6219/`
- `parity/evidence/investigate/pi/71003cfe-3806-4276-8dab-438f304c23c2/` (supplemental)
- `parity/reference/cursor-plugins/pstack/skills/how/SKILL.md`
- `extensions/pi-pstack/skills/how/SKILL.md` (read for text compare only)
- `extensions/pi-pstack/src/workers.ts` (Task registration, capability check only)
- `parity/evidence/investigate/how-explainer-protocol.json` (machine-readable twin of the method choice)
