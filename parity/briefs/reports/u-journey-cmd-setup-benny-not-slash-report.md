# u-journey-cmd-setup-benny-not-slash report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, both not-slash path entry, no live automation). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `78443bd1-b96b-4e85-9abc-89f42abaae14` |
| pi | `0ff31b2a-d6cc-45f4-8264-aa0d1982e6bc` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-not-slash-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true` on the paired attempts)

## Not-slash bootstrap on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=not-slash reason=pack bootstrap to destination setup-benny`. Settled screen shows FOR_AGENTS → destination setup-benny/SKILL.md, pack verify, first repo question. No `/setup-benny` invoke. No automation create. `src/app.js` digest unchanged. |
| pi | **yes** | `STATUS=not-slash reason=asked first setup question which repository` (attempt done-copy; fixture-out later overwritten by a discarded rerun with similar text). Session tools are bash reads of FOR_AGENTS then done write. Assistant states no slash invoke and no automation this turn. Same product digest. |

Worker capture playbook. `parity/evidence/setup-benny/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Waited for concurrent `capture-setup-grok-xhigh-cap.mjs` to finish and kept models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Seeded fixture with Benny pack under `.upstream/automations/benny/` and no completed setup config.
3. Wrote `PLAYBOOK.md` and `parity/scripts/capture-setup-benny-not-slash.mjs` (self-test green, including denial-of-slash case).
4. `node parity/scripts/capture-setup-benny-not-slash.mjs --cursor-only` (first attempt `5e5b3016…`, discarded for models.mdc race).
5. Waited again for Grok-cap, then `--pi-only` → `0ff31b2a…`.
6. Fixed scorer false positive on negated `` `/setup-benny` `` mentions; gated module `isMain` after an import accidentally re-ran capture.
7. Paired Cursor `78443bd1…` (clean rule digest) with Pi `0ff31b2a…`. Re-read settled screens, done markers, product digest, attempt `identity.json` + `events.jsonl`.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, with Grok-cap waits between sides.
2. First Cursor attempt discarded because shared models.mdc drifted mid-run; paired the later Cursor attempt with locked digest.
3. One import-triggered accidental rerun created Cursor `78443bd1…` and incomplete Pi `b850b50f…` (killed). Pi pair keeps the intentional `0ff31b2a…`.
4. Pi stopped at FOR_AGENTS step 1 (ask target repo) before reading destination setup-benny/SKILL.md. Still path entry, not slash.
5. Pack prose still names `.cursor/automations/benny/` while the held-out fixture stores files under `.upstream/automations/benny/`.
6. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
7. Did not commit.

## Honest product gaps

1. FOR_AGENTS / setup-benny destination path strings still say `.cursor/...` in pack prose. Pi host fixture uses `.upstream/...`. Agents reconcile, but chrome differs by host.
2. This journey stops at pack-bootstrap confirmation / first setup question. It does not complete config fill or `/automate` creation (forbidden until explicit ask).
3. Acceptance text for exact STATUS reason strings remains DRAFT / host-dependent.
4. Initial scorer treated assistant denials containing `` `/setup-benny` `` as invokes. Fixed in the capture script before pairing.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `cmd-setup-benny-not-slash` evidence when ready. Close `PSTACK-CMD-SETUP-BENNY-NOT-SLASH-001` when oracle freeze allows.
2. Optionally normalize pack prose paths for Pi `.upstream` vs Cursor `.cursor` in a later product pass.
3. Keep Grok-cap and other models.mdc writers serialized against journey captures.
