# REA / dependency inventory refresh @ tip ae5650f

**User goal.** Keep `extensions/pi-pstack` at Pi-native parity with Cursor plugin `pstack` with zero runtime Cursor pstack plugin dependency. This unit only refreshes measured inventory evidence after tip advanced past prior lock `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`.

## Tip lock

| Field | Measured value |
| --- | --- |
| Tip clone | `/tmp/cursor-plugins-rea` |
| Tip HEAD | `ae5650febf4320793844c12c4adaa937f417f8da` |
| Prior inventory lock | `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe` |
| Commits tip-only since prior | `111ee2e` feat(lark-base); `ae5650f` merge #1150 |
| Paths touched under `pstack/` or `cursor-team-kit/` | **none** (`git diff --stat` empty) |
| pstack plugin version | **0.15.36** (`.cursor-plugin/plugin.json`) |
| cursor-team-kit version | **1.2.0** |
| Tip pstack skill dirs | **58** (identical set to prior lock; `comm` empty vs `4dd1d05:pstack/skills`) |
| Tip↔cache `SKILL.md` | **58/58** sha equal (`1ba91fc25c0977741dd0e267849e6234b037ed0a`) |

## Soft-deps vs `extensions/pi-pstack` (closed)

All six poteto soft-dep skill paths remain present under `extensions/pi-pstack/skills/`.

| Soft-dep | Tip source | tip→pi `SKILL.md` sha | Status |
| --- | --- | --- | --- |
| `deslop` | tip `cursor-team-kit` | EQUAL `2f7b7def…0f810` | closed / vendored |
| `control-cli` | tip `cursor-team-kit` | EQUAL `13ac93e5…422a2` | closed / vendored |
| `control-ui` | tip `cursor-team-kit` | EQUAL `410cae25…51871` | closed / vendored |
| `benchmark-checklist` | tip `pstack` | EQUAL `ba109e96…0fca0` | closed / vendored |
| `no-comments` | tip `pstack` | DIFF (Pi-native rewrite; expected per `skill-matrix.tsv`) | closed / vendored |
| `create-skill` | Cursor builtin `~/.cursor/skills-cursor/create-skill` | DIFF (Pi rewrite; expected) | closed / vendored |

No new soft-dep names appear in tip `poteto-mode/SKILL.md` Non-negotiables beyond this set.

## REA `analyze_javascript_application` (detail=summary)

| Target | Artifact SHA-256 | Parent evidence id | Summary evidence id | Parse stats |
| --- | --- | --- | --- | --- |
| `pstack/skills/poteto-mode/scripts` | `ab08fdd851002bfdd61fcc3c902bf0e6bb2bbd4b0229b5443e30626e3a788e07` (unchanged vs prior) | `ev_bc03872ae9472937e943a625972a8f0184eb82efc4371e4549bf25174c26329f` | `ev_7a5c86223d156c9d9210912df8bd4d8665e75832b5558fd224d480946684cf25` | 13 JS parsed, 0 failures, child-process relations 3 |
| `pstack/skills/statechart/scripts` | `2193bf21071d9a8d176d142c5aa0d3257c98de4689e948e21b20957f83616e33` (unchanged) | `ev_7fc7aabece436555e98cdd2d829d1d68f9ccad585706f3c0e716c32ba80e6507` | `ev_4d004a15b6aac2fa09b101dc394cae649e87e7d403fdfc0b511abace239bf621` | Full tree pass (no `source_paths`); 48 JS parsed, 0 failures, child-process relations 26 |
| `cursor-team-kit/skills/pr-review-canvas` | `2666f69c5a27cb4256a403747f8606c55d68b7ab28556d7f0d3fe6fe359f9b3a` (unchanged) | `ev_0a3ba031aa8d9e21a59ec1e5b10af4587a6a5ddcc8fce2bcaf0857896684c77e` | `ev_9c52e5e62157c9217d0850bd3763da9b6927023a2ff509dbecc87757961f7ba2` | 1 JS parsed; `template.html` inline script still unanalyzed |

Team-kit has one JS executable (`renderer.js`). Remaining team-kit skills inventoried by tree digests only (Markdown/agents/rules; no extra JS).

## New unknowns

None for inventory closure. REA still reports analysis-coverage unknowns (semantic graph partial, poteto 3303 / statechart 12803 / canvas 356 semantic unknowns; canvas 1 application unknown for unanalyzed inline HTML script). Those match prior disposition. They are not missing closure nodes and do not open soft-deps.

No new tip pstack skill directories since `4dd1d05`.

## Evidence bundle export

`export_evidence_bundle` → `parity/evidence/rea-pstack-0.15.36/rea-deps/evidence-bundle-ae5650f.json` (`overwrite: true`). Measured: **105577865** bytes, **8** records, **0** unknowns in the export result.

## Inventory still closed

**PASS.** Tip advance is unrelated (`third_party`/lark-base only). pstack **0.15.36**, skill count **58**, soft-deps present and closed as above, executable digests unchanged, no new skill dirs, no new inventory-unknown nodes.

## Principles applied

- **Prove It Works.** Digests, skill counts, soft-dep shas, and REA evidence ids measured on tip HEAD and on disk under `extensions/pi-pstack`.
- **Build the Lever.** Shell inventory + REA MCP analyses; exportable bundle path for rerun.
- **Sequence Work into Verifiable Units.** Tip HEAD → skill set → soft-deps → REA trees → bundle → this note.
