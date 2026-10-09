# u-journey-cmd-bro report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, honest host deltas). Both hosts produced a jargon-dense prior reply, then `/bro` wrote a plain restatement with zero listed jargon terms and `bro=yes` markers. No product continuation. Ledgers untouched. No commit.

Oracle note. The brief says "restates the ask before acting." Scenario and requirement `PSTACK-CMD-BRO-RESTATE-001` require a plain restatement of the last agent message. Capture followed the requirement.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `7ee333ca-e68a-4ddf-a8dd-447d0299b524` |
| pi | `245dd8fa-b145-4258-9c81-cdc0101caf61` |

Pair. `parity/evidence/bro/pair-bro-restate-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Restate before product action on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `screen-03-jargon-settled.txt` shows libuv/microtask jargon reply. `/bro` appears at `screen-04`/`05`. `restate-after.md` is plain (digest `6d6cc52e…`). `done.txt` = `bro=yes`. No product files under fixture cwd. |
| pi | **yes** | Same ordering on `screen-03` then `04`/`05`. Session `01a11d72…` injects bro prompt/skill. Tools are only `write`/`write` for marker paths. Restate digest `e2885f35…`, `bro=yes`. |

Worker capture playbook. `parity/evidence/bro/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Wrote worker `PLAYBOOK.md`, fixture-app README, then `parity/scripts/capture-bro-restate.mjs`.
3. `node parity/scripts/capture-bro-restate.mjs --cursor-only` (~91s).
4. `node parity/scripts/capture-bro-restate.mjs --pi-only` (~36s).
5. Re-read screens `03`/`05`/`07`, restates, Pi session tool order, identity/events.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Restate wording differs across hosts (short Cursor paragraph vs longer Pi prose). Both plain; jargon-term scan empty on both.
3. Pi `screenScore.continuedPrior` false-positive from residual prompt text; cleared by fileScore and empty `productFilesTouched`.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or family stubs.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-05 / `cmd-bro-restate` evidence when ready.
2. Optionally align the brief title with the requirement (last-message restate, not "restate the ask").
