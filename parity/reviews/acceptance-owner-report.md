I've written a DRAFT of the setup acceptance definitions under `parity/acceptance/` in the isolated worktree. Nothing is frozen and nothing certifies parity. Every definition is still `unverified`, and no successful Cursor setup run exists. The only reference controls are the slash menu, the two-Enter submission and the `included_usage` failure. That failure covers one negative definition (ACC-SETUP-004) and is not counted as success anywhere.

**Model identity.** The runtime variables in this session read `PI_MODEL=claude-opus-5-5`, `PI_PROVIDER=claude-subscription` and `PI_REASONING_LEVEL=high`. I did not observe the parent's runtime, so its `openai/gpt-6.1-sol` identity comes only from the brief.

**What I read.**
- The full contract (437 lines) and all seven parent draft ledgers.
- The locked setup `SKILL.md`, the full pstack `README.md` including the mode paragraph at line 91, guide page `01-setup.md`, and the setup lines of `poteto-help`.
- The Cursor first-run captures and the candidate-baseline captures.
- To confirm my findings, I read the candidate code at baseline `78dd5a0`. No expectation was taken from it.

The reference checkout HEAD is `ccb5507`. The pstack and cursor-team-kit file counts (164 and 29) and the hashes of the setup skill, README and plugin manifest match `source-lock.json`.

**Owned files** (all under `/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/`, sha256):

| File | sha256 |
| --- | --- |
| `MANIFEST.sha256` | `78db6d2f1d6df138c670e18df6a8000f12434e39eed15489db91fdbe20807d80` |
| `setup-pstack/definitions.json` | `e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4` |
| `setup-pstack/configurations.json` | `3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f` |
| `setup-pstack/record-hashes.json` | `5d6197d7e8441267bec8a8420da92d019a7426b8fc84923e72dd508938c25963` |
| `README.md` | `d928003a26312065b74bb7c043c957e2ebc8c7f004421f8b1f33ce06d70c274b` |
| `review/parent-drafts-review.md` | `169a5e19ee3ed56f2811954a43d3d7bab29d3a323f127eb09556fc981369f762` |
| `open-queue.json` | `57a5aee14a336df58206cee97778bab723f595bdfd5da061f6b1587740d3e5d3` |
| `CHANGELOG.md` | `c81f921974c410bcf2ab4ddd55929c34eb723df2f33636925c026635b1facc96` |
| `tools/verify-acceptance.mjs` | `ab780f98baf3d30c0e81e42ad22081d53d0a9b79cdf26a3512ee6010ac7b8b00` |
| `tools/selftest.sh` | `6abde9bbe326bb41b88b152e7f1e4deff217111ad7471ad74b6d433d04aec0c6` |

`git status` shows only `parity/` as new, and nothing is committed. Nothing was written to the parent checkout or to implementation code.

**What the definitions cover.** There are 43 records across 92 configuration cells. The cell count covers setup only, and `denominatorComplete` is false. Each record has:
- the verbatim source excerpt, its line locator and the file sha256;
- exact strings, including the four budget labels with U+2014 and the scripted verification-offer text;
- a matrix over the rule-state, model-catalog, budget, project, surface, usage, platform and answer axes;
- actions and expectations, plus required and forbidden effects;
- any host translation the record needs, and its open questions.

Together they cover:
- discovery, the natural-language triggers and model detection, including the empty-catalog paste request and the alias rules;
- loading an existing rule and dropping retired role lines;
- each budget's effort mapping, with expected tables for all four budgets;
- the same-family fallback and roles marked as needing a choice;
- a full expected rule file for a rerun over the captured Cursor user rule;
- panel lists of any length, with order and alias entries kept;
- validation and re-asking, the whole-file overwrite and rerunning with identical bytes;
- the file-write permission gate in the reference host, which is unobserved;
- cancellation, the confirmation message, and all three branches of the verification offer.

Atomic writes are explicitly not required because the source does not establish them.

**Source contracts versus runtime controls.** Each record carries a `basis` list. Counted over those lists, 37 records cite explicit source text, 7 rest on inferences that need review, 3 have one preliminary Cursor observation, and 5 are unobserved host or model behavior. In Cursor, setup is run by the model. So even explicit source expectations still need captured reference runs, with repeat runs for any text the model produces.

**Protection and invalidation.** These rules are enforced by the verifier, not only described in the README:
- Edits come in as proposals.
- A reviewer on a different model family from the implementer accepts them, and a second reviewer on another family is needed to move from DRAFT to REVIEWED.
- No proposal may weaken a record without reference evidence.
- Evidence binds to a per-record hash, and changing a record makes that evidence stale.
- The verifier refuses a frozen status without a reviewer and reference runs.

The self-test injects eight faults: a weakened label, a wrong locator, a silent edit, an unreviewed freeze, an unknown configuration, a deleted record, tampered reference evidence and an unrecorded governance edit. The verifier rejected all eight, and the unmodified copy passed (run this session).

**Draft findings that need correction.** The full list is R-01 to R-20 in the review file. The most important:
- **R-15.** The candidate's default judgment model is `claude-opus-5-5-max` in `models.ts` line 13 and in eight translated skills. The reference default is `claude-opus-5-5-xhigh`. From static reading I expect ACC-SETUP-020, 040 and 074 to fail under the large budget. That is a guess until a candidate run shows it.
- **R-10 to R-12.** Single, unpaired captures show the candidate:
  - reached the budget selector while showing "No models available";
  - lists two menu rows for setup where Cursor lists one;
  - submits on one Enter where Cursor needs two.
- **R-09.** The Cursor reference ran in the real user home. A successful setup there would overwrite the account owner's rule file. Reference runs need an isolated home, or owner approval with a backup and restore.
- **R-04.** The candidate terminal had tmux extended keys off. Any Option+Enter or Alt+Enter mode evidence captured that way is invalid.
- **R-01 to R-03.** The draft requirements combine several separately testable behaviors and leave out others from the README mode paragraph and the setup guide.
- **R-17.** The candidate's project-level rule override has no traced source.

**Remaining gaps.** These are kept in `open-queue.json` (items OQ-001 to OQ-017):
- successful Cursor reference runs, blocked by the usage limit and not waived;
- how other skills read the rule, and whether a new rule applies only to new sessions;
- the `create-verification-skill` journey and `poteto-help` behavior;
- slugs without an effort token, malformed rules and interrupted writes;
- the supported platforms and session surfaces;
- the reviewed host-translation mapping, which every translated record depends on;
- the hidden test wording for natural-language triggers;
- the rest of the dependency closure.

I did not check whether `ccb5507` is the current upstream main.

**Principles applied.**
- Build the Lever is why the hashes and checks live in a rerunnable verifier rather than a hand checklist.
- Prove It Works is why the self-test injects faults instead of trusting one passing run.
- Encode Lessons in Structure is why the freeze and stale-evidence rules fail the verifier rather than only appearing in the README.
- Unslop shaped this reply.

To recheck everything, run `node parity/acceptance/tools/verify-acceptance.mjs --reference-root <parity>/reference/cursor-plugins --parity-root <parity>`.