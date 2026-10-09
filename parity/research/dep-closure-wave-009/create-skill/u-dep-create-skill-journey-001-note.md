# Append-only note: u-dep-create-skill-journey-001

capturedAt: 2026-10-09 (local run after wave-009 audit)
unit: u-dep-create-skill-journey-001
pair: parity/evidence/create-skill/pair-create-skill-impl-1.json
pairId: create-skill-impl-1

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `67eb4a01-244d-4d1a-a27d-5b09b30d426e` | SKILL.md wrote via `/create-skill`; STATUS=wrote |
| Pi | `f4c14017-4188-461c-9fa0-076e7995059d` | SKILL.md wrote via `/create-skill` host equivalent; STATUS=wrote |

## Phase matrix disposition (this unit only)

| Phase | Status after this pair |
| --- | --- |
| create-skill-discovery | still open (not exercised as a separate journey) |
| create-skill-design | still open (not exercised as a separate journey) |
| create-skill-implementation | closed_by_this_pair (both hosts wrote SKILL.md via create-skill path) |
| create-skill-verification | still open (discovery/application of the authored skill not proven) |

## Evidence pointers

- Capture lever: `parity/scripts/capture-create-skill-impl.mjs`
- Durable Cursor SKILL.md: `parity/evidence/create-skill/fixture-out/cursor/SKILL.md` (sha256 `c5a3793642d9c279bbf69b4f068944f676b9dc7d03dbea17b19102b94557b309`)
- Durable Pi SKILL.md: `parity/evidence/create-skill/fixture-out/pi/SKILL.md` (sha256 `2ea35e992d7a32834b19e7c70e3c631fe60fb22cf41414a54a6dbebe6e9c7995`)
- Prior wave-009 audit (hitCount=0) remains the pre-journey baseline: `parity/research/dep-closure-wave-009/create-skill/journey-audit.json`

## Honesty

- Sequential `--cursor-only` then `--pi-only`. Pi `cleanGenerated` removed Cursor live `.cursor/skills/` tree. Durable proof is `fixture-out/<side>/SKILL.md`.
- Family-13 create-verify pairs are a different skill and do not close this journey.
- Ledgers were not edited.
