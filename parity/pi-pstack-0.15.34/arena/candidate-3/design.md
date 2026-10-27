# Candidate 3: Lean filter + bump pin

## Problem

Move pi-pstack from pstack 0.15.30 (`eb4db2b`) to 0.15.34 while keeping Pi-native host behavior and a lock that is the registry of truth. Upstream at the version-bump commit `164ced10fa576ddf91e1f03b4fa9d1183c8272fe` adds `ketchup-video` and rewrites `statechart` to TypeScript with a ~376-path `scripts/test/**` corpus; tip `519d36a` is the same ship set plus one statechart SIGKILL wait in that corpus. Today's `targetFor` ships every path under `pstack/{skills,agents,automations,docs}/`, so a blind pin would balloon the lock from 183 files to 579 and force SCRIPT-001 off obsolete `statechart.mjs`. Constraints that bind the shape: no hand edits of vendored lock targets; SOURCE + lock remain the single registry; user-facing parity in a Pi-native way; full verify → confirm → fact-check ladder (not package gates alone); laziness — smallest change that solves.

## Usage (caller's view)

### Maintainer README (after the bump)

```sh
# Pin is the version-bump commit, not tip. Corpus never enters the package.
# scripts/sync-upstream.mjs:
#   SOURCE.commit = 164ced10fa576ddf91e1f03b4fa9d1183c8272fe
#   SOURCE.pstackVersion = '0.15.34'
#   EXCLUDE = [/^pstack\/skills\/statechart\/scripts\/test\//]

git clone https://github.com/cursor/plugins.git /tmp/cursor-plugins
bun run sync:upstream -- --source /tmp/cursor-plugins   # writes ~203 files; drops stale targets
bun run check:upstream -- --source /tmp/cursor-plugins  # GREEN iff disk == plan(SOURCE, EXCLUDE)
bun run typecheck && bun run test
bun run live:e2e -- --model deepseek/deepseek-flash
# then control-pi / live confirm, then independent sha256 fact-check of every lock target
```

Package version becomes `0.15.34-pi.1`. Runtime statechart entry is `skills/statechart/scripts/statechart` → `statechart.ts` plus `backends/`, `frontends/`, `passes/`, `package.json`, `references/`, `SKILL.md`. `scripts/test/**` is absent by construction. No new host-map lines.

### Call site 1 — sync owns ship set

```js
import { SOURCE, EXCLUDE, targetFor, buildPlan, lockFor } from './scripts/sync-upstream.mjs';

expect(SOURCE.commit).toBe('164ced10fa576ddf91e1f03b4fa9d1183c8272fe');
expect(SOURCE.pstackVersion).toBe('0.15.34');
expect(targetFor('pstack/skills/statechart/scripts/statechart.ts')).toBe(
  'skills/statechart/scripts/statechart.ts',
);
expect(targetFor('pstack/skills/statechart/scripts/test/corpus/Counter/chart.mmd')).toBeUndefined();
expect(EXCLUDE.some((re) => re.test('pstack/skills/statechart/scripts/test/cli.test.ts'))).toBe(true);

const plan = buildPlan('/tmp/cursor-plugins');
// plan has no scripts/test/** targets; lockFor(plan) is the new upstream.lock.json body
```

### Call site 2 — Pi user / agent surface (unchanged shape)

```text
/ketchup-video          → skill attaches; video steps use existing Skipped-in-Pi when Pi has no render path
/statechart             → skill attaches; agent runs <SKILLS>/statechart/scripts/statechart SPEC.tla
/reflect                → existing agent-transcripts map; no new sections.ts line
```

### Call site 3 — package SCRIPT-001 after rewrite

```ts
const bin = join(SKILLS_DIR, 'statechart/scripts/statechart');
spawnSync(bin, ['--help'], …);           // exits 0, usage from statechart.ts
spawnSync(bin, ['from-spec', spec], { env: without TLA2TOOLS }); // exits 2, TLC locate message
// poteto bun test suite still ships and still runs (not under EXCLUDE)
```

## Shape

Data first: `SOURCE` is the pin (`commit`, `pstackVersion`, `teamKitVersion`). `EXCLUDE` is a regex list declared next to `SOURCE` — the structural record of “matches the tree, does not ship.” `targetFor(source)` is the sole ship-or-not function: apply `EXCLUDE`, then the existing team-kit / license / pstack path rules. `buildPlan` → `lockFor` → `writePlan` stay the pipeline; `writePlan` already deletes stale targets, so a lean sync removes previously shipped corpus without a second delete pass.

Load-bearing decisions:

1. **Pin `164ced1`, not tip.** Tip only waits in a corpus test we refuse to ship. Version identity and user-facing skill text are identical at the bump. Per laziness-protocol and model-the-domain: the registry names the release commit, not an incidental test fix.
2. **Exclude encoded beside SOURCE.** Corpus exclusion is not a post-sync `rm`. `check:upstream` regenerates the plan with the same `EXCLUDE` and fails if disk still has test paths or if someone removes the exclude and re-syncs without intending to. Single source of truth per encode-lessons-in-structure.
3. **Parity means user-facing behavior.** Shipped set = every skill body agents read + every runtime script those bodies invoke (`statechart`, `statechart.ts`, backends/frontends/passes, package.json, poteto CLIs, etc.). Upstream’s private compiler corpus is not part of the Cursor→Pi user contract. Byte parity holds for every *shipped* path after declared transforms.
4. **Minimal host map.** Zero edits to `sections.ts`. `ketchup-video`’s render step is a Cursor-shaped capability; the existing `Skipped in Pi: …` line is the parity mechanism. Image generation for `/ketchup` already has a line. Reflect’s transcript discovery already maps through the agent-transcripts paragraph. No proactive video/path invention.
5. **Verification ladder is mandatory.** RED count pins → move SOURCE + add EXCLUDE → sync GREEN → check → typecheck/test (SCRIPT-001 retargeted; resources counts updated) → control-pi/live confirm → independent sha256 fact-check of lock targets. Package green alone does not finish the work.

Interface depth: maintainers touch two constants and keep one function. That surface hides the 376-path corpus decision, stale-target cleanup, lock hashing, and frontmatter/patch transforms. Callers never see wire git-ls-tree rows. What stays exposed is intentional: the pin, the exclude list, and `targetFor` so tests can assert ship policy without reimplementing it.

Invariants in types/structure: `EXCLUDE` is exported and tested; `targetFor` returns `undefined` for every excluded source; lock `files[].source` never matches `EXCLUDE`; package tests pin `SOURCE` and assert absence of `skills/statechart/scripts/test/`. Validation at the sync boundary; pure `targetFor` inside.

Deliberately does not: ship tip; ship the corpus; add host-map lines; hand-delete after sync; weaken the confirm/fact-check ladder; invent a Pi video API.

## Synthesis decision

Candidate package only. Arena synthesis fills this after comparing candidates.

## Tradeoffs accepted

- We accept a lock that is a strict subset of upstream’s tree in exchange for a package sized to runtime use (~203 vs 579 files) without losing `/statechart` or `/ketchup-video` skill text.
- We accept skipping tip’s SIGKILL wait in exchange for pinning the release bump; that wait only matters inside the excluded corpus.
- We accept “Skipped in Pi” for ketchup-video render when no Pi video path exists, in exchange for not expanding `sections.ts` on speculation.
- We accept rewriting SCRIPT-001 statechart cases onto the new launcher, in exchange for keeping the gate that bundled CLIs start.
- We accept re-tuning RES-00x file/skill counts, in exchange for the lock remaining the exact shipped set.

## Alternatives considered

- **Tip pin (`519d36a`) with full `targetFor`.** Exposes a 579-file lock and a corpus the Pi user never runs; hides nothing the bump pin doesn’t already deliver for user-facing skills. Lost: tip’s only delta is excluded-corpus test timing — interface gets heavier with no caller benefit.
- **Bump pin + ship full corpus.** Same bloat; “parity” defined as path-count mirroring instead of behavior. Lost: violates laziness; package becomes a test archive.
- **Sync everything, then hand-delete `scripts/test/**`.** Looks lean on disk but leaves exclusion outside the registry — `check:upstream` and the next sync fight the deletes. Lost: two sources of truth; encode-lessons-in-structure fails.
- **Expand `sections.ts` with a ketchup-video / video render map.** Surfaces a host concept Pi does not own; callers must learn a speculative API. Lost: deeper interface for no proven capability; Skipped-in-Pi already covers it.
- **Package-gate-only verification.** Smaller maintainer loop, but fails the user’s done predicate (confirm + independent fact-check). Lost: false completion.

## Open questions and risks

- Should `EXCLUDE` ever grow beyond statechart’s `scripts/test/**`, or is any future fixture filter a new deliberate regex with its own test?
- Does `statechart`’s first-run mise install of TLC/Java need a README Limits note beyond retargeting the TLC-missing SCRIPT-001 case?
- Will poteto’s recorded pass count (`68 pass`) still match at `164ced1`, or must SCRIPT-001’s assertion update with evidence from one green run?

## Next implementation step

Add exported `EXCLUDE` next to `SOURCE`, retarget `SOURCE` to `164ced1` / `0.15.34`, make `targetFor` return `undefined` for excluded sources, and add a unit assertion that corpus paths do not ship — before running sync.
