# REA dependency inventory: pstack 0.15.36 + cursor-team-kit

## Why

Map every executable under tip pstack and cursor-team-kit so pi-pstack can reach Pi-native parity without depending on the Cursor pstack plugin install.

## Verdict

Tip pstack and the installed cache share identical digests for both executable script trees. All **62** JS/TS files under tip `pstack` + `cursor-team-kit` were REA-analyzed (0 parse failures). pi-pstack already vendors poteto-mode and statechart script trees with package-name remaps. The only npm runtime dependency in that closure is **commander@14.0.0**. Statechart's hard runtime deps are external (mise, Java, TLC), not npm.

## Targets

| Target | Files | JS/TS | Artifact SHA-256 | REA analyze evidence |
| --- | --- | --- | --- | --- |
| cursor-team-kit (plugin) | 29 | 1 | (plugin inventory) | N/A for Markdown-only skills |
| pr-review-canvas (JS surface) | 4 assets | 1 | `2666f69c…9b3a` | `ev_9245e935…9baf25` |
| poteto-mode/scripts | 18 | 13 | `ab08fdd8…8e07` | `ev_bb692108…92169` |
| statechart/scripts | 405 | 48 | `2193bf21…6e33` | prod `ev_afb32043…b5895` + tests `ev_9760595a…d422` |

Cache vs tip: poteto 18/18 identical; statechart 405/405 identical; plugin root differs only by cache marker `.cache-complete`.

## cursor-team-kit

Mostly Markdown skills, agents, and rules (deslop, control-cli, control-ui, verify-this, etc.). Not skill/agent Markdown only. One JS executable exists: `skills/pr-review-canvas/renderer.js` (DOM helpers for the canvas template). REA parsed 1 JS file, 0 child-process relations. `template.html` has an inline script REA explicitly left unanalyzed.

No `package.json` under team-kit.

## poteto-mode/scripts

Entrypoints: `watch-pr/watch-pr` (bun), `check-plan.mjs` (node), `bootstrap.ts` (Bun.spawnSync install), `worktree-audit.sh` (bash).

Parity-critical behavior (measured from source + REA child-process family count=3):

- Bootstrap installs frozen lockfile so `commander` is present, then re-execs.
- `watch-pr/cli.ts` uses commander 14.
- `watch-pr/github.ts` spawns `gh` (and related argv) via `node:child_process.spawn`.

Locked npm: commander@14.0.0; bun-types@1.3.14; typescript@7.0.2 (+ transitive @types/node, undici-types).

pi-pstack vendors this tree. Diff vs tip is package rename `@cursor-skill/*` → `@pi-pstack/*`, matching bun.lock name line, and an adapted `worktree-audit.sh` for Pi transcript paths. All `.ts`/`.mjs` sources match tip byte-for-byte.

## statechart/scripts

Entrypoints: `statechart` shell wrapper, `statechart.ts` (node CLI spawning worker), `run.ts` (TLC/Java).

Parity-critical behavior (REA child-process relations 17 in production pass):

- Resolves TLC via mise or `TLA2TOOLS` / `JAVA`.
- Pins mise Java tool id `java@temurin-25`.
- Spawns `java` against tla2tools (`tlc2.TLC`) and manages process groups.

npm: `fast-check@4.5.3` dev-only; **no lockfile** in tree.

Corpus is mostly `.tla`/`.out`/`.cfg` fixtures (not JS). All 48 JS/TS files covered across two selective REA passes (26 production + 22 tests/corpus `view.mjs`).

pi-pstack vendors this tree; only `package.json` name differs.

## npm closure (executable trees)

See `npm-closure.json`. Runtime npm for pstack executables: commander only. Team-kit canvas has zero npm. External tools (bun, gh, mise, Java, TLC) are part of the operational closure for parity.

## Evidence of done

- `rea-inventory.json` lists every tip JS/TS under pstack+team-kit with `status: analyzed` and evidence ids.
- Non-JS team-kit files listed `not-applicable` with reason.
- Compact digests recorded; no new 85MB bundle copied into this owned path (parent already has `../evidence-bundle.json`).

## Principles applied

- **Build the Lever.** Hash-compare and inventory scripts under this path (`hash-compare-cache-vs-tip.json`, `pi-vs-tip-scripts.json`).
- **Guard the Context Window.** REA `detail: summary` plus selective `source_paths` for statechart; compact JSON deliverables instead of re-exporting the full bundle.
- **Prove It Works.** Deliverable files written and coverage counts checked against `find` inventory (62/62 JS/TS analyzed).
