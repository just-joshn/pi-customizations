# u-fio-playbook-gate report

## Status

**pass.** FIGURE-IT-OUT-PLAYBOOK-FIRST closed on a linked Cursor+Pi pair. Both hosts `playbook_before_product`. Gate unit tests green. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID | Ordering |
| --- | --- | --- |
| cursor | `38afcd44-b9f2-4ba3-ad91-f345d71bdd73` | playbook_before_product (reuse pair-1; fixture digest unchanged) |
| pi | `8a0cf95a-64a7-4256-accb-89ca93ac5804` | playbook_before_product (fresh `--pi-only` after gate) |

Pair. `parity/evidence/figure-it-out/pair-figure-it-out-playbook-first-2.json`

Prior fail. `parity/evidence/figure-it-out/pair-figure-it-out-playbook-first-1.json` (Pi product-first bash).

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Playbook before product?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | FS poll. `decisions.tsv` at `2026-10-08T19:14:06.421Z`; first product `src/store.js` at `2026-10-08T19:14:35.506Z`. |
| pi | **yes** | FS poll. `PLAYBOOK.md` at `2026-10-08T19:27:17.106Z`; first product at `2026-10-08T19:27:30.652Z`. Session `01a11cfb…` blocked two early bash calls with the playbook gate, then `write PLAYBOOK.md` before any `src/*` write. |

## Product change (commit-worthy summary, not committed)

Added `registerFigureItOutPlaybookGate` beside the how/why spawn gates. On an expanded `<skill name="figure-it-out">` turn it injects a playbook-first usage section, blocks `bash`/`edit`/`write` until a write/edit lands on a playbook path (`PLAYBOOK.md`, `decisions.tsv`, `DECISIONS.md`, `.audit/`, …), and nudges once on settle if none landed. Capture `isPlaybookPath` now also treats `decisions.md` / `DECISIONS.md` as trail paths.

## Commands run

1. Unit tests. `bun run test -- test/figure-it-out-playbook-gate.test.ts test/how-spawn-gate.test.ts test/why-spawn-gate.test.ts` → 19 passed.
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. `node parity/scripts/capture-figure-it-out-playbook-first.mjs --pi-only` (~56s). Exit 0. `playbookBeforeProduct: true`.
4. Re-read Pi poll log, screens, session tool order (gate block text on first bash results).

## Deviations

1. Reused Cursor pair-1 attempt (brief allows reuse when fixture identical). Fresh Pi only.
2. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
3. Did not commit.

## Suggested follow-ups for the coordinator

1. Point family-05 / FIGURE-IT-OUT-PLAYBOOK-FIRST at pair-2 and mark the mismatch reconciled.
2. Land the gate sources when ready to commit.
