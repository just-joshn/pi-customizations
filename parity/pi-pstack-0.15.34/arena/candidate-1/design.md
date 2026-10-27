# Candidate 1 — Laziest full-parity (0.15.30 → 0.15.34)

## Problem

Move `extensions/pi-pstack` from pinned pstack **0.15.30** (`eb4db2b`) to tip **0.15.34** (`519d36aa98955bf680db01bcde5fdfba686dc901`) with team-kit still **1.2.0**, ship every file `targetFor` already selects (including the rewritten statechart TypeScript tree and its large test corpus), keep the Pi host (`src/`) unchanged unless a failing test proves a Cursor→Pi gap, and finish with the same user-facing ladder that closed 0.15.30: package gate → control-pi/live confirm → independent sha256 fact-check. The shape is non-obvious because the delta is mostly vendored bulk (~396 extra paths) plus one new skill (`ketchup-video`) whose media needs look like they might want a new host-map line, while the existing sync/lock/test machine already encodes “SOURCE + `upstream.lock.json` are the registry” and “no hand edits to lock targets.” Constraints from Phase A: leave `targetFor` alone; do not invent a second disposition registry; Pi stays 1.4.0-native; work only in the `pi-pstack-0.15.34` worktree.

## Usage (caller's view)

### Maintainer quickstart (after this bump lands)

```sh
# Worktree: .../pi-customizations-wt/pi-pstack-0.15.34
cd extensions/pi-pstack

# 1. Pin already points at tip; regenerate or verify against a cursor/plugins checkout
git clone https://github.com/cursor/plugins.git /tmp/cursor-plugins   # or refresh existing
bun run sync:upstream -- --source /tmp/cursor-plugins                # writes 579 files + lock
bun run check:upstream -- --source /tmp/cursor-plugins               # "579 files match 519d36aa…"

# 2. Package gate
bun run typecheck
bun run test

# 3. User-surface confirm (same bar as 0.15.30)
# control-pi doctor + drive; pi -p /statechart and /ketchup-video smoke; live:e2e

# 4. Independent fact-check: re-derive ls-tree through targetFor, sha256 every target
#    without trusting the lock text as oracle
```

What the maintainer imports or edits: **`SOURCE` in `scripts/sync-upstream.mjs`**, **count pins in `test/resources.test.ts` / e2e host+package**, **SCRIPT-001 statechart entry in `test/scripts.test.ts`**, and **docs/`package.json` version strings**. They do **not** edit vendored skill bodies by hand. They do **not** open `src/sections.ts` unless a new test fails on a Cursor concept the map does not already cover.

### Call site 1 — regenerate after moving the pin

```js
// scripts/sync-upstream.mjs (maintainer edits only SOURCE, then runs CLI)
export const SOURCE = {
  repository: 'https://github.com/cursor/plugins',
  commit: '519d36aa98955bf680db01bcde5fdfba686dc901',
  pstackVersion: '0.15.34',
  teamKitVersion: '1.2.0',
};

// CLI (unchanged):
//   node scripts/sync-upstream.mjs --source /tmp/cursor-plugins
// → writePlan(buildPlan(checkout)): 579 targets, lock.source === SOURCE
```

### Call site 2 — RED pins before GREEN sync

```ts
// test/resources.test.ts — fail first, then sync makes them pass
expect(lock.source).toEqual({
  repository: 'https://github.com/cursor/plugins',
  commit: '519d36aa98955bf680db01bcde5fdfba686dc901',
  pstackVersion: '0.15.34',
  teamKitVersion: '1.2.0',
});
expect(lock.files).toHaveLength(579);
expect(Object.fromEntries(transformCounts)).toEqual({
  none: 517,
  frontmatter: 61,
  'patch:worktree-audit-pi-transcripts': 1,
});
expect(skills).toHaveLength(62); // 61 one-seg + create-skill
expect(skills.filter((s) => s.disableModelInvocation)).toHaveLength(57);
expect(tracked.size).toBe(580); // 579 lock + authored create-skill
```

### Call site 3 — SCRIPT-001 against the new CLI (no `statechart.mjs`)

```ts
// test/scripts.test.ts — rewrite obsolete mjs cases; keep SCRIPT-001 tag
const STATECHART = join(SKILLS_DIR, 'statechart/scripts');
const bin = join(STATECHART, 'statechart'); // mode 100755 shim → statechart.ts

// Missing SPEC: exit 2, stderr includes Usage: statechart SPEC.tla ...
const missing = spawnSync(bin, [], { encoding: 'utf8', cwd: scratch, timeout: 60_000 });
expect(missing.status).toBe(2);
expect(missing.stderr).toContain('Usage: statechart SPEC.tla');

// Optional second smoke: --help is not a flag; wrong arity is the contract.
// Do not assert TLC install success in unit tests; that belongs to confirm/TLC evidence.
```

### End-user surface (unchanged call shape, new skill name)

```text
pi -e ./extensions/pi-pstack
/setup-pstack
/statechart …          # skill attaches; model runs skills/statechart/scripts/statechart
/ketchup-video …       # new; video render may Skipped-in-Pi or fall back like ketchup image
/poteto-mode <goal>
```

## Shape

**Data structures first.** The domain registry is already two values: `SOURCE` (pin) and `upstream.lock.json` (every shipped `source`/`target`/`transform`/`sha256`). This design adds no third registry. Derived expectation counts (`ExpectedCounts`) are computed from `git ls-tree` ⊕ `targetFor` at the pinned commit, then hardcoded into tests once—same derivation rule as 0.15.30. A `BumpPlan` is an ordered ladder of phases (`frame` → `red` → `green` → `script` → `docs` → `verify` → `confirm` → `fact-check`), not a new runtime module.

**Load-bearing decisions**

1. **Pin tip `519d36aa`, not version-bump-only `164ced1`.** Target sets are identical; tip adds the statechart SIGKILL wait that upstream needs. Prefer tip so Pi ships what HEAD tests. (`per model-the-domain`, `per prove-it-works`)
2. **Keep `targetFor` verbatim.** Full corpus ships. Filtering tests/corpus would invent a shipping policy outside SOURCE+lock. (`per laziness-protocol`, `per single source of truth`)
3. **No proactive `src/` / `sections.ts` change for `ketchup-video`.** Existing image line (ketchup) and `Skipped in Pi: …` cover Cursor-only media. Host map grows only when a new test proves a named Cursor concept the map cannot already express. (`per subtract-before-you-add`, `per boundary-discipline`)
4. **Mechanical bump order is the architecture:** RED count/pin tests → move `SOURCE` → `sync:upstream` GREEN → rewrite SCRIPT-001 for `scripts/statechart` → docs/`package.json` → typecheck/test → confirm → fact-check. (`per sequence-verifiable-units`, `per encode-lessons-in-structure`)
5. **Transforms stay the two declared ones** (frontmatter + `worktree-audit-pi-transcripts`). Statechart TS and corpus are `transform: none` (or frontmatter for its `SKILL.md` only). No new patch unless `--check` proves bytes need one.

**Invariants in types / pins**

- `SourcePin.commit` must equal lock `source.commit` and plugin.json versions at that commit.
- `lock.files.length === 579`; transform histogram `{ none: 517, frontmatter: 61, patch: 1 }`.
- Loaded skills `62`; hidden `57`; invocable remain setup-pstack + create-skill + three team-kit skills.
- Authored set stays `['skills/create-skill/SKILL.md']` only.
- `targetFor` returns `undefined` only for non-shipped team-kit paths and non-`(skills|agents|automations|docs)` pstack paths—unchanged.

**Validation at boundaries**

- Sync CLI: `assertVersions` + sha256 plan vs disk (`--check`).
- Tests: RES-* pins and SCRIPT-001 behavior.
- Confirm/fact-check: real Pi RPC and independent hash re-derivation (outside unit tests).

**Deliberately does not do**

- Filter corpus/tests out of the package.
- Add a ketchup-video / video-tool host-map bullet up front.
- Hand-edit any lock target after sync.
- Shorten verification to package-gate-only.
- Change Pi peer versions or host feature set for this bump.

**Interface depth.** Public surface for this change is tiny: edit `SOURCE`, run sync, update pins/docs, rewrite two SCRIPT tests. All complexity (579-file plan, transforms, stale deletion, mode bits) stays inside `sync-upstream.mjs`. Callers never see wire/git types. That is deeper than a “smart filter + host completeness layer” that would expose shipping policy and Cursor feature enumeration to every bump.

## Synthesis decision

Awaiting arena synthesis. This package is **Candidate 1 (Laziest full-parity)** only; it is not the synthesized base.

## Tradeoffs accepted

- We accept shipping ~400 corpus/test fixtures in the npm/Pi package in exchange for zero new `targetFor` policy and bit-identical upstream trees after transforms.
- We accept that `/ketchup-video` may often emit `Skipped in Pi` or text fallback when video render is unavailable, in exchange for not growing `sections.ts` on speculation.
- We accept longer confirm/fact-check wall time (and possible TLC/mise network on first statechart run) in exchange for the same done predicate that closed 0.15.30.
- We accept obsolete poteto/script pass-count strings may need a one-line update when upstream’s own suite numbers move, in exchange for not inventing a parallel SCRIPT-002 ID.
- We accept tip-over-bump-commit (`519d36aa` vs `164ced1`) even though file sets match, in exchange for including upstream’s post-bump test wait.

## Alternatives considered

- **Pin `164ced1` (version bump only).** Hides nothing useful from callers; exposes a stale HEAD relative to upstream’s own SIGKILL wait. Lost: identical `targetFor` set, weaker “latest 0.15.34” claim.
- **Filter statechart `test/` / corpus out of `targetFor`.** Smaller package, but leaks a second shipping policy into `targetFor` and forces every future bump to re-argue the filter. Callers then must learn two registries. Lost on interface depth and domain modeling.
- **Proactive ketchup-video / video host map in `sections.ts`.** Exposes a speculative Cursor concept to every session prompt; hides little the Skipped/image lines already cover. Lost until a RED host test names a concrete gap.
- **Package-gate-only verification.** Faster, but leaves user-surface and byte-parity claims unproven—the exact risk the 0.15.30 ladder was built to catch. Lost against the user-required done predicate.

## Open questions and risks

- Does the new `scripts/statechart` first-run mise/TLC install need a Limits README bullet beyond the old `TLA2TOOLS` jar note, or does upstream’s skill text already cover it for Pi readers?
- Should SCRIPT-001’s second case invoke the real binary with a tiny fixture (and allow skip without TLC/mise), or stay at “missing SPEC → usage + exit 2” only until confirm?
- Will `host.e2e`’s `Installed skills (61):` string become `(62):` including `ketchup-video` in sort order, and does any snapshot elsewhere hard-code the old alphabetized prefix?
- Is Pele (statechart render.md) another Skipped-in-Pi path on this host, and do we record that only in confirm evidence rather than the host map?

## Next implementation step

Derive Exact `ExpectedCounts` from `/tmp/cursor-plugins` at `519d36aa`, write the RED pin updates in `test/resources.test.ts` and the two e2e skill-count assertions, and run them to prove failure before touching `SOURCE`.
