# Playbook: u-journey-cmd-automate-me

Falsifiable done predicate. `parity/evidence/automate-me/pair-automate-me-existing-skill-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations re-read the seeded `*-mode/SKILL.md` before and after and record whether that path was updated in place with no second parallel `*-mode` skill (or an honest fail/mismatch); report published at `parity/briefs/reports/u-journey-cmd-automate-me-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on on-disk path reuse (before/after digests + mode-skill census). Medium on slash chrome and AskQuestion confirm UI (brief prefers the smallest explicit-update refresh path).

## Phases

1. Scaffold held-out fixture with one seeded `parity-fixture-mode` skill per host path (`.cursor/skills/...` and `.pi/skills/...`). Verify. Baseline digests recorded; no `fixture-out` done markers yet.
2. Write `parity/scripts/capture-automate-me-existing-skill.mjs` with residual-safe `/automate-me update ...` prompt, live FS poll of mode-skill paths, and before/after re-read. Verify. Locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; skill before/after digests written; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score per host from polls, screens, and on-disk skill census. Verify. Verdict in `{refreshed_in_place, parallel_skill_created, unchanged, missing_seed, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if a side invents a parallel skill (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.
- Driving the ambiguous AskQuestion update-versus-fresh UI (explicit update request is the smallest refresh path).

## Held-out candidate task (what the hosts see)

A tiny fixture already containing `parity-fixture-mode/SKILL.md` with a `PARITY-FIXTURE-MODE-SEED` marker. Invoked via `/automate-me update my existing ... skill`. Agents must not be told this is a parity skill-activation experiment.
