# u-journey-cmd-interrogate report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts activated `/interrogate`, reported synthesized findings, and left `src/total.js` byte-identical before/after (no auto-apply). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `e94a4325-4950-4d13-839c-d51aa452ec28` |
| pi | `f23257ca-3195-4872-bc76-a41553e0c3da` |

Pair. `parity/evidence/interrogate/pair-interrogate-no-autoapply-1.json`

Fixture rule digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

Product digest. `d79612f5fcc31ae51500259caa1f1ec988db986622f38620f6e496387f47aae7` (identical before/after on both hosts; re-read after capture)

## Contract held?

| Side | Skill activated | Findings reported | Product unchanged | Auto-applied | Verdict |
| --- | --- | --- | --- | --- | --- |
| cursor | **yes** | **yes** (`done.txt` findings=yes; PTY 7/7 sections) | **yes** | **no** | **yes** |
| pi | **yes** | **yes** (`done.txt` findings=yes; session 7/7 sections) | **yes** | **no** | **yes** |

Oracle. Product file digest before vs after. Settled screens and Pi session re-read. Pi `wroteProduct: false` in session tools.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Seeded contested `parity/evidence/interrogate/fixture-app/src/total.js`, wrote `PLAYBOOK.md` plus `parity/scripts/capture-interrogate-no-autoapply.mjs`.
4. `node parity/scripts/capture-interrogate-no-autoapply.mjs --cursor-only` (~81s).
5. `node parity/scripts/capture-interrogate-no-autoapply.mjs --pi-only` (~46s).
6. Re-read product digests, both settled screens, Pi session tool order.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Locked `interrogate reviewers: inherit-parent` is a one-entry list, so each host ran Reviewer A only. Still adversarial review with a synthesized verdict; matches the configured panel length.
3. Settled screens can scroll the Intent heading off; full PTY/session still score all verdict sections.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge `interrogate-no-autoapply-1` into family-06 / `cmd-interrogate-no-autoapply` evidence and close PSTACK-CMD-INTERROGATE-NO-AUTOAPPLY-001 when ready.
2. Optional later recapture with a multi-entry `interrogate reviewers` list if multi-model consensus must be shown in the same pair.
