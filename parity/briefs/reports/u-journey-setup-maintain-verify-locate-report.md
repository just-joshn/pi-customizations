# Report: maintain-verify locate pair

## Status

**pass** for `PSTACK-SETUP-MAINTAIN-VERIFY-LOCATE-001` on the one-skill and none branches. Pair `maintain-verify-locate-1`.

Both hosts found a seeded `verify-hello-cli` with Launch/Drive and a feature map, wrote `LOCATED=<absolute SKILL.md>`, and stopped after Pass step 0. Both hosts, with zero verify skills, wrote `LOCATED=none` / `CREATE_OFFERED=yes` and pointed at `/create-verification-skill` without inventing a target.

The several-candidates ask branch was not captured.

## Attempts

| Host | Mode | Attempt ID | Locate |
| --- | --- | --- | --- |
| Cursor | one | `66944536-aadc-4b80-9be0-d3bd924e4057` | `LOCATED=.../.cursor/skills/verify-hello-cli/SKILL.md` |
| Pi | one | `073160f6-9e82-49fc-9bd0-9c1539341f50` | `LOCATED=.../.pi/skills/verify-hello-cli/SKILL.md` |
| Cursor | none | `f8ea88ab-9875-4370-875e-a2771c5d3753` | `LOCATED=none` + `CREATE_OFFERED=yes` |
| Pi | none | `ab0b1495-90e3-482c-b195-93600c824b5f` | `LOCATED=none` + `CREATE_OFFERED=yes` |

Primary pair attempt IDs are the **one** rows. None attempts are evidence for the none clause of the expectedObservation.

## Artifacts

- Pair: `parity/evidence/maintain-verify/pair-maintain-verify-locate-1.json`
- Capture script: `parity/scripts/capture-maintain-verify-locate.mjs`
- Markers: `fixture-out/{cursor,pi}/{one,none}/locate.txt`
- Decision log: `parity/evidence/maintain-verify/.audit/u-journey-setup-maintain-verify-locate.tsv`

## On-disk oracle (re-read)

Cursor one marker equals the absolute `.cursor/skills/verify-hello-cli/SKILL.md` path. Settled screen confirmed Launch/Drive plus feature map and stopped.

Pi one marker equals the absolute `.pi/skills/verify-hello-cli/SKILL.md` path. On-disk `features/` existed. Settled screen incorrectly said there was no feature map, then still stopped after locate.

Cursor and Pi none markers are `LOCATED=none` and `CREATE_OFFERED=yes`. Screens point at `/create-verification-skill` and do not create a skill.

## Honest gaps

- Several-candidates prompt branch not paired (`--several` exists in the lever, unused).
- Sibling reqs not claimed: SOURCE-WAVE, LIVE-PASS, EDIT-SCOPE, OUTCOMES (prior create-verify maintain pair already covers outcomes).
- Pi one-skill screen misstated feature-map presence (on-disk map was present).
- Capture prompts named the expected path / marker format. Agents still had to invoke maintain and stop after locate on a real PTY.

## Not claimed

- No ledger edits.
- No `pstack-models.mdc` writes (setup-grok held the shared lock during this run).
- No commit.
