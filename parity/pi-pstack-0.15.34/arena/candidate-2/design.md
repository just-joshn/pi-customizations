# Candidate 2: Host-complete tip pin

## Problem

Move `extensions/pi-pstack` from pstack 0.15.30 (`eb4db2b`) to 0.15.34 while keeping 100% Pi-native parity: every lock target byte-matches after declared transforms, the host stays Pi, and the user-required verify → confirm → fact-check ladder all PASS. The tip `519d36aa98955bf680db01bcde5fdfba686dc901` and the version-bump commit `164ced1` share the same `targetFor` set (579 files, ketchup-video, statechart TS rewrite + corpus), but tip alone carries the statechart SIGKILL-wait test fix. The non-obvious part is not the pin math — it is which Cursor concepts the new skills invent that Pi cannot run literally. ketchup-video's silent video render and reflect's "copy into `.cursor/skills/` / `~/.cursor/skills/`" install destinations are host concepts; inventing a video tool or hand-editing vendored skill text would break the SOURCE+lock domain. The host map in `src/sections.ts` is the typed boundary for those concepts. SCRIPT-001 still asserts `statechart.mjs` and a TLA2TOOLS-missing path that no longer exist; the shell entry `scripts/statechart` plus mise/TLC first-run are the new contract. Constraints from grounding: no hand edits to lock targets; `targetFor` stays the full corpus (no test/corpus filter); work only in this worktree; Laziness Protocol — smallest change that solves.

## Usage (caller's view)

### README / quickstart the maintainer runs

```sh
# 1. Move the pin (SOURCE.commit → 519d36aa…, pstackVersion → 0.15.34; team-kit stays 1.2.0)
# 2. Regenerate lock + vendored tree from a cursor/plugins checkout that contains the tip
bun run sync:upstream -- --source /path/to/cursor/plugins
bun run check:upstream -- --source /path/to/cursor/plugins   # GREEN: 579 files match tip

# 3. Package gates
bun run typecheck
bunx vitest run

# 4. Live Pi surface (control-pi / e2e host map) then independent sha256 fact-check of lock targets
```

After the bump, a Pi session that loads pi-pstack lists `Installed skills (62)` (ketchup-video in the set) and reads two new host-map lines before it invents tools: video render is Skipped-in-Pi with a mermaid-or-slides fallback, and reflect install destinations resolve to `.pi/skills/` and `$PI_AGENT/skills/`.

### Call site 1 — sync domain (SOURCE + lock remain truth)

```js
import { SOURCE, targetFor, buildPlan, lockFor } from '../scripts/sync-upstream.mjs';

SOURCE.commit;        // '519d36aa98955bf680db01bcde5fdfba686dc901'
SOURCE.pstackVersion; // '0.15.34'
SOURCE.teamKitVersion;// '1.2.0'

targetFor('pstack/skills/ketchup-video/SKILL.md');
// → 'skills/ketchup-video/SKILL.md'

targetFor('pstack/skills/statechart/scripts/test/corpus/Counter/chart.mmd');
// → 'skills/statechart/scripts/test/corpus/Counter/chart.mmd'  (full corpus ships)

const plan = buildPlan('/path/to/cursor/plugins');
plan.length; // 579
```

### Call site 2 — host map (Cursor concepts → Pi)

```ts
import { hostSection, type HostFacts } from './sections.ts';

const facts: HostFacts = { /* packageRoot, skillsDir, agentDir, … */ };
const text = hostSection(facts);

// Model reads, among other lines:
// - ketchup-video silent video: Skipped in Pi + mermaid slides / ketchup text+visuals fallback
// - reflect install: `.cursor/skills/<skill>/` → `.pi/skills/<skill>/`
//                    `~/.cursor/skills/<skill>/` → `${agentDir}/skills/<skill>/`
// - create-skill path map stays; reflect destinations are explicit, not inferred
```

### Call site 3 — SCRIPT-001 against the shell entry

```ts
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SKILLS_DIR } from '../src/paths.ts';

const bin = join(SKILLS_DIR, 'statechart/scripts/statechart');

spawnSync(bin, ['--help'], { encoding: 'utf8' });
// stdout starts with: Usage: statechart SPEC.tla [--config FILE] [--view FILE] [--out DIR]
// documents: first run installs TLC and Java with mise (needs network);
//            or set TLA2TOOLS + JAVA

spawnSync('node', ['--test', 'test/*.test.ts'], { cwd: join(SKILLS_DIR, 'statechart/scripts') });
// upstream suite; TLC-gated tests skip without TLA2TOOLS / after mise
```

## Shape

**Data structures.** `SOURCE` is the single registry of which upstream commit and versions the package claims. `upstream.lock.json` is the derived per-file truth (`source`, `target`, `transform`, hashes, mode). `targetFor` is the pure path predicate: every `pstack/{skills,agents,automations,docs}/**` path and the three team-kit skills map in; nothing else. `HostFacts` stays the input struct for the host map; no new fields — skill-install destinations and video policy are pure functions of existing `skillsDir` / `agentDir` / package facts. The host map string is the only public adaptation surface for Cursor concepts skills invent.

**Flow.** Maintainer edits `SOURCE` → `buildPlan` reads tip via `git show` → transforms (frontmatter + WTA patch) → writes tree + lock. At runtime Pi builds `HostFacts` and injects `hostSection` / `subagentsSection`. SCRIPT-001 spawns the `statechart` shell wrapper (not `statechart.mjs`), asserts help text and the documented first-run/mise contract without requiring a networked mise install in CI; optional deeper TLC tests stay env-gated.

**Load-bearing decisions.**

1. Pin tip `519d36aa…`, not `164ced1`. Same `targetFor` corpus; tip alone has the SIGKILL-wait fix. Domain stays SOURCE+lock. Per model-the-domain / single-source-of-truth.
2. Keep full corpus. Filtering tests out of `targetFor` would invent a second ship policy and break lock = truth. Per boundary-discipline / laziness-protocol.
3. Host map owns ketchup-video and reflect install. No video tool in Pi → one `Skipped in Pi` line plus mermaid-or-slides (or ketchup's existing text+visuals) fallback. Reflect's `.cursor/skills/<skill>/` and `~/.cursor/skills/<skill>/` destinations map to `.pi/skills/<skill>/` and `${agentDir}/skills/<skill>/`. Per boundary-discipline: host map is the typed boundary; lock targets stay byte-identical.
4. SCRIPT-001 rewritten against `scripts/statechart` + document mise/TLC first-run. Obsolete mjs assertions deleted. Poteto pass-count assertion refreshed to tip's suite. Per make-operations-idempotent / encode-lessons-in-structure.
5. Verification ladder unchanged: RED counts → SOURCE move → sync GREEN → check → typecheck/test → control-pi/live → independent sha256 fact-check. Per prove-it-works.

**Interface depth.** Public surface stays three deep modules: (1) sync (`SOURCE` / `targetFor` / `buildPlan` / `--check`), (2) `hostSection(facts)`, (3) vitest SCRIPT-001 / HOST-* contracts. Complexity hidden: tip vs bump equivalence, corpus size (~407 new statechart paths), video absence, mise first-run, WTA patch re-anchor. Exposed to callers: pin fields, host-map lines the model must obey, and shell-entry invocation. No transport types on the API; no new sync subclass for "host-aware vendor."

**Deliberately does not.** Implement a Pi video renderer. Hand-edit ketchup-video or reflect skill text. Filter corpus from the lock. Soften verification to package-gate-only. Add a second registry beside SOURCE.

## Synthesis decision

Candidate package only. Arena synthesis fills this section.

## Tradeoffs accepted

- We accept shipping ~407 statechart test/corpus files in exchange for lock = full `targetFor` truth and SCRIPT-001 parity with upstream's own suite.
- We accept tip (`519d36aa…`) over the version-bump commit in exchange for the SIGKILL-wait fix with zero extra `targetFor` delta.
- We accept a longer host-map prompt (two proactive lines) in exchange for the model not inventing a video tool or writing under `~/.cursor`.
- We accept Skipped-in-Pi for silent video (no Pi tool) in exchange for never pretending a render path exists.
- We accept documenting mise/TLC first-run (network) rather than bundling TLC jars in exchange for matching upstream's install story.
- We accept rewriting SCRIPT-001 assertions (help text, entry path, poteto counts) in exchange for tests that fail on the real tip contract.

## Alternatives considered

- **Pin `164ced1` (version bump only).** Same corpus, missing tip's statechart SIGKILL-wait test fix. Exposes callers to a "0.15.34" label that is not tip; hides nothing the tip pin already ships. Lost: tip is free once the corpus is accepted.
- **Filter tests/corpus out of `targetFor`.** Smaller package, but callers must learn a second ship policy and SCRIPT-001 cannot run upstream's corpus suite from the package. Hides size; exposes a forked truth. Lost: violates SOURCE+lock as single registry.
- **Host map: none / generic Skipped-in-Pi only.** Smaller `sections.ts` diff. Exposes ketchup-video and reflect install as guesswork; model invents tools or Cursor paths. Hides almost no policy. Lost: host map is the typed boundary for concepts skills invent.
- **Hand-edit vendored ketchup-video / reflect text.** Avoids host-map lines. Exposes every future sync to merge conflict and breaks "no hand edits to lock targets." Lost: domain invariant.
- **Build a Pi silent-video renderer.** True ketchup-video parity. Huge new host surface for one skill; Pi has no video tool today. Lost: Laziness Protocol / out of scope for a pin move.
- **Package-gate-only verification.** Faster. Exposes the user to unverified live and hash drift. Lost: user required the full 0.15.30 confirm+fact-check ladder.

## Open questions and risks

- Does the poteto `bun run test` pass count at tip still match the current `68 pass` assertion, or must SCRIPT-001's regex move with the tip suite?
- Should SCRIPT-001's statechart suite run `node --test` from `package.json` (upstream) or only the shell `--help` / first-run message contract in CI, leaving TLC corpus tests to an opt-in `TLA2TOOLS` / mise job?
- When ketchup-video is Skipped-in-Pi for render, is the mandated fallback "mermaid slides that mirror the skill's slide plan" or "fall through to `/ketchup`'s text+visuals path," and should HOST-006 grow a sibling assertion for that line?
- Does the WTA patch in `patches.json` still anchor exactly once on tip's `worktree-audit.sh`, or does the tip text require a patch-edit before sync GREEN?

## Next implementation step

Set `SOURCE` to tip `519d36aa…` / `0.15.34`, run `sync:upstream`, then rewrite SCRIPT-001 against `scripts/statechart` and add the two host-map lines before touching live verification.
