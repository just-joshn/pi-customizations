# pi-maintainer run plan

This is the workflow the coordinator runs. `docs/ARCHITECTURE.md` is the design contract. `docs/decisions.tsv` is the decision trail.

## Definition of done

The run is done when all of these hold on the branch head.

- `node scripts/check-parity.mjs --final` passes. Every census unit maps to verified ledger rows or to a justified non-claim.
- Each SAR passed its own gate, listed below, before the next SAR started.
- A PR for `feat/pi-maintainer-2` is open.

## Rigor

Rigor is high because the claim is total parity. Three independent checks back every behavior.

1. **Oracle.** Aider's own Python at the pinned commit produces the expected outcome of each ported function. A port is wrong when it differs.
2. **Ledger.** Every paragraph, table row, list item, code block, diagram, evidence probe, and pinned Aider test is a census unit. The gate fails on any unit without a verified row or a non-claim.
3. **Real Pi.** Integration tests drive the Pi SDK in process. Journeys drive the real `pi` binary in print and RPC modes.

## The SAR loop

Each SAR runs the same six acceptance stages. Recovery and independent port work may overlap the obligation mapping, but an incomplete map remains a blocker to accepting the SAR. A component check establishes only that component's result. It never establishes SAR completion or permits the next SAR to start.

| Unit | Work | Check |
| --- | --- | --- |
| S1 ledger | Rows and coverage for the SAR slice: its document, its evidence directory, and the Aider tests it owns | `check-parity.mjs --fragment` passes, and the SAR slice has no uncovered unit |
| S2 ports | Oracle-verified ports of the SAR's Aider modules, one worktree per independent module | vitest, tsc, Biome, and `capture-oracle.mjs --check` are clean |
| S3 wiring | The SAR's options, commands, and port registered through the core | Pi SDK integration tests pass |
| S4 rows | Each row gets its Pi mechanisms, sources, and tests, then `verified` | `check-parity.mjs --feature <sar>` passes |
| S5 journeys | Real `pi` print and RPC journeys with a scripted provider | Journey scripts exit 0 and their artifacts are saved |
| S6 review | Code review, `/deslop`, `/no-comments`, an independent ledger audit, ordered commits | Review findings resolved, decision rows written |

## SAR slices

A SAR owns its document units (`<sar>/...`), its evidence units (`ev-<sar>/...`), and its Aider tests. `parity/sources.json` assigns single-purpose test modules to a SAR. `parity/test-owners.json` assigns each test of the shared modules (`test_coder`, `test_commands`, `test_main`, `test_models`) to one SAR. A behavior that needs code from two SARs belongs to the later SAR in build order.

## SAR 1, edit

| Id | Unit | Depends on | Worktree branch |
| --- | --- | --- | --- |
| E0 | Shared CPython difflib port | none | `pm/difflib` |
| E1 | Gate slicing, test owners, complete edit obligation map | none | `pm/ledger` |
| E2 | SEARCH/REPLACE port (`editblock_coder.py`, fenced variant) | E0 | `pm/editblock` |
| E3 | Unified diff port (`udiff_coder.py`, active `search_replace.py`, diff-match-patch) | E0, E6 contract | `pm/udiff` |
| E4 | Custom patch port (`patch_coder.py`) | none | `pm/patch` |
| E5 | Whole-file port finish (NUL-path resolution gap, ported tests) | none | `pm/wholefile` |
| E6 | Core: Feature contract, settings, exchange controller, Pi wiring, SDK test harness | none | `pm/core` |
| E7 | Prompts: every edit prompt module and Aider's system-prompt formatting | none | `pm/prompts` |
| E8 | Edit commands, chat modes, architect and context flows | E6, E7 | later |
| E9 | File watcher and AI comments | E6, tree-sitter prototype | later |
| E10 | Model settings: default edit format and editor policy per model | E6 | later |
| E11 | Edit journeys, print and RPC | E2 through E10 | later |
| E12 | Row verification, edit gate, reviews, commits | all | coordinator |

## Recovery ownership

Eight delegates stopped with provider rate limits. Their commits and unfinished files are retained in their worktrees. Recovery uses native Pi Tasks whose observed model is `openai/gpt-6.1-sol`.

At most two implementations run concurrently, counting parent-authored product changes as one implementation. When both slots are occupied, the parent may review, run checks, integrate unchanged checked commits, and update the audit trail. Repairs wait for a free slot. Reviews do not start another implementation or delegate their own fanout.

A replacement gets the original brief, the surviving branch state, the extraction receipt, and the remaining acceptance obligations. Reports from stopped delegates are historical evidence, not completion verdicts. Each accepted component is checked again at the integrated head. E1's ledger rows remain open until implementation and behavioral tests establish them.

## SARs 2 to 4

Git, map, and lint each run the same loop after the previous SAR passes its gate. Their unit tables are written when they start, from their S1 ledger fragment.
