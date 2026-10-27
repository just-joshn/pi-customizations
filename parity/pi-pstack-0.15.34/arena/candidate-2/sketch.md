# Type sketch — Candidate 2: Host-complete tip pin

Caller's usage is in `design.md`. Types below serve that usage. Bodies stay `not implemented` / TODO until Phase D.

## Module map

```
extensions/pi-pstack/
  scripts/
    sync-upstream.mjs     # SOURCE pin, targetFor, buildPlan, lockFor, --check
    patches.json          # WTA-001 only; re-anchor if tip still matches once
  src/
    sections.ts           # hostSection + subagentsSection (Cursor→Pi boundary)
    paths.ts              # PACKAGE_ROOT, SKILLS_DIR (unchanged)
    index.ts              # wires HostFacts → hostSection (unchanged shape)
  test/
    scripts.test.ts       # SCRIPT-001: poteto + statechart shell entry
    e2e/host.e2e.test.ts  # HOST-001…: assert new video + reflect-install lines
    resources.test.ts     # lock/authored counts at 579 / skill list +ketchup-video
  skills/                 # lock targets only — no hand edits
  upstream.lock.json      # derived from SOURCE @ tip
  package.json            # version 0.15.34-pi.* ; description bump
```

Ownership: sync owns upstream truth; `sections.ts` owns host adaptation; tests own the verification contracts. Skills under `skills/` are read-only outputs of sync.

## Domain: SOURCE + lock

```js
// scripts/sync-upstream.mjs

/** Single registry of which upstream the package claims. */
export const SOURCE = {
  repository: 'https://github.com/cursor/plugins',
  commit: '519d36aa98955bf680db01bcde5fdfba686dc901',
  pstackVersion: '0.15.34',
  teamKitVersion: '1.2.0',
};

/** Authored here; never overwritten by sync. */
export const AUTHORED = ['skills/create-skill/SKILL.md'];

/**
 * Maps an upstream path to its place in this package, or undefined when the file does not ship.
 * Invariant: same predicate as 0.15.30 — full pstack skills|agents|automations|docs tree,
 * plus deslop/control-cli/control-ui, plus the two LICENSE copies. No corpus/test filter.
 */
export function targetFor(source /*: string */): string | undefined {
  // not implemented — keep current body; tip adds paths only through existing arms
  throw new Error('not implemented');
}

/**
 * @typedef {{
 *   source: string,
 *   target: string,
 *   transform: 'none' | 'frontmatter' | `patch:${string}`,
 *   mode: string,
 *   sourceSha256: string,
 *   targetSha256: string,
 *   sourceFrontmatter?: string,
 *   bytes: Buffer,
 * }} PlanEntry
 */

/** Read tip via git show; apply transforms; return plan. Asserts plugin.json versions. */
export function buildPlan(checkout /*: string */): PlanEntry[] {
  // TODO: cat-file tip; ls-tree; filter targetFor; transformEntry; assertVersions 0.15.34 / 1.2.0
  throw new Error('not implemented');
}

/** Serialize lock JSON (source: SOURCE, files without bytes, authored). */
export function lockFor(plan /*: PlanEntry[] */): string {
  throw new Error('not implemented');
}

// CLI: sync writes tree+lock; --check diffs disk to regenerated plan (exit 1 on drift).
```

## Host map: typed boundary for Cursor concepts

```ts
// src/sections.ts — HostFacts unchanged; new policy lives in hostSection lines.

export interface HostFacts {
  packageRoot: string;
  skillsDir: string;
  skillNames: readonly string[];
  agentDir: string;
  rulePath: string;
  sessionDir: string;
  sessionFile: string | undefined;
  subagentDir: string;
  storeDir: string;
  rootStoreDir: string;
  loopAvailable: boolean;
  questionsAvailable: boolean;
}

/**
 * Cursor→Pi map. Invariants encoded in the returned text (not optional flags):
 * - Image path (HOST-006) stays.
 * - ketchup-video silent video: no Pi video tool → one Skipped-in-Pi line + mermaid-or-slides fallback.
 * - reflect skill-install destinations map to Pi skill dirs (project + agent).
 * - Generic Skipped-in-Pi catch-all remains for other Cursor-only steps.
 */
export function hostSection(facts: HostFacts): string {
  // TODO: keep existing lines; extend create-skill / path line for reflect destinations;
  //       add video line next to image generation.
  //       Installed skills (62): 58 pstack one-seg + 3 team-kit + create-skill (was 61).
  throw new Error('not implemented');
}

/** Unchanged contract; model list + agent catalog. */
export function subagentsSection(
  agents: readonly AgentDefinition[],
  models: readonly AvailableModel[],
): string {
  throw new Error('not implemented');
}
```

### Host-map line contracts (pseudocode the string must satisfy)

```ts
// Derived from HostFacts — single source; do not duplicate path math elsewhere.

function reflectInstallLines(facts: HostFacts): string[] {
  // `.cursor/skills/<skill>/`  → `.pi/skills/<skill>/`
  // `~/.cursor/skills/<skill>/` → `${join(facts.agentDir, 'skills')}/<skill>/`
  // Never edit plugins/cache; after approval copy into the Pi destination and edit the copy.
  throw new Error('not implemented');
}

function ketchupVideoLine(): string {
  // ketchup-video's silent landscape video render has no Pi counterpart.
  // `Skipped in Pi: render ketchup-video silent video. Pi has no video tool.`
  // Then: build the skill's slides as mermaid (or fall through to /ketchup text+visuals);
  // embed nothing as mp4; still list action items as ketchup-video requires.
  throw new Error('not implemented');
}
```

## SCRIPT-001: statechart shell entry + mise/TLC first-run

```ts
// test/scripts.test.ts

const STATECHART_SCRIPTS = join(SKILLS_DIR, 'statechart/scripts');
const STATECHART_BIN = join(STATECHART_SCRIPTS, 'statechart'); // shell entry → statechart.ts

describe('bundled scripts run from the package (SCRIPT-001)', () => {
  test("upstream's poteto test script passes once CLIs' bootstrap has installed deps", () => {
    // TODO: refresh expected pass count against tip (was /\n 68 pass\n 0 fail\n/)
    throw new Error('not implemented');
  });
  // watch-pr / orch / check-plan / log.sh — keep; only adjust if tip breaks them
});

describe('statechart shell entry runs from the package (SCRIPT-001)', () => {
  test('--help prints Usage and exits 0', () => {
    // spawn STATECHART_BIN with ['--help'] OR invoke so USAGE prints (tip prints USAGE on bad args;
    // prefer: run with no args / --help per tip CLI — assert first line:
    // 'Usage: statechart SPEC.tla [--config FILE] [--view FILE] [--out DIR]'
    throw new Error('not implemented');
  });

  test('documents mise/TLC first-run (SKILL + stderr contract)', () => {
    // Assert vendored SKILL.md still says: first run installs TLC and Java with mise (needs network).
    // Assert findTlc failure path names mise install OR TLA2TOOLS+JAVA (no old statechart.mjs / jar-URL-only text).
    // Do not require networked mise in default CI.
    throw new Error('not implemented');
  });

  test.skipIf(!process.env.TLA2TOOLS && !process.env.PI_PSTACK_STATECHART_LIVE)
    ('upstream node --test suite passes when TLC is available', () => {
      // cwd STATECHART_SCRIPTS; `node --disable-warning=ExperimentalWarning --test test/*.test.ts`
      // or `bun run test` if package.json script is used. Tip corpus ships via lock.
      throw new Error('not implemented');
    });
});

// DELETE obsolete describe('statechart.mjs runs from the package') and TLA2TOOLS-unset
// assertions that expect the old jar-download stderr from statechart.mjs.
```

## Package / count contracts

```ts
// test/resources.test.ts (and host.e2e skill-count line)

const EXPECTED = {
  lockFiles: 579, // targetFor at tip
  // Grounding: 61 one-seg (58 pstack + 3 team-kit), 62 loaded (+create-skill).
  // hostSection "Installed skills (N)" uses package scan = loaded = 62.
  packageSkillNames: 62,
  teamKitVersion: '1.2.0',
  pstackVersion: '0.15.34',
  sourceCommit: '519d36aa98955bf680db01bcde5fdfba686dc901',
};
```

## Verification ladder (procedure, not a type)

```
1. RED: counts / SCRIPT-001 / host skill list fail against 0.15.30 tree
2. SOURCE move → sync:upstream GREEN (579 files written from tip)
3. check:upstream GREEN
4. typecheck + vitest (incl. rewritten SCRIPT-001, HOST lines for video + reflect install)
5. control-pi / live host surface (user behavior verify)
6. confirm on real Pi
7. independent sha256 fact-check of lock targets vs tip+transforms
```

Idempotent: re-running sync at the same SOURCE is a no-op on content; `--check` is the drift detector. Crash halfway through writePlan: re-run sync (stale targets removed from previous lock, then rewritten).

## What this sketch refuses

- Second ship filter inside `targetFor` for `test/` or `corpus/`.
- Pin at `164ced1` when tip is free.
- New `src/video.ts` or codemode video API.
- Editing `skills/ketchup-video/**` or `skills/reflect/**` by hand.
- Dropping steps 5–7 of the verification ladder.
