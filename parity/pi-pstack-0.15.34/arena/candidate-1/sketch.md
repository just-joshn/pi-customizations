# Sketch — Candidate 1: Laziest full-parity

Types and signatures first. Bodies are `not implemented` or pseudocode. Module map at the end. Usage in `design.md` is the spec; this sketch agrees with it.

## Core types

```ts
/** Single source of truth for the upstream pin. Lives as SOURCE in sync-upstream.mjs. */
export interface SourcePin {
  repository: 'https://github.com/cursor/plugins';
  /** Tip of pstack 0.15.34; not 164ced1. */
  commit: '519d36aa98955bf680db01bcde5fdfba686dc901';
  pstackVersion: '0.15.34';
  teamKitVersion: '1.2.0';
}

export type TransformId =
  | 'none'
  | 'frontmatter'
  | `patch:${string}`; // only patch:worktree-audit-pi-transcripts today

/** One row in upstream.lock.json after sync. */
export interface LockFileEntry {
  source: string; // path inside cursor/plugins
  target: string; // path inside extensions/pi-pstack
  transform: TransformId;
  mode: '100644' | '100755';
  sourceSha256: string;
  targetSha256: string;
  sourceFrontmatter?: string; // present iff transform === 'frontmatter'
}

export interface LockDocument {
  source: SourcePin;
  files: LockFileEntry[];
  authored: readonly ['skills/create-skill/SKILL.md'];
}

/**
 * Counts derived once from `git ls-tree <commit>` ⊕ targetFor, then pinned in tests.
 * Measured at 519d36aa with current targetFor (identical set to 164ced1).
 */
export interface ExpectedCounts {
  lockFiles: 579;
  transformNone: 517;
  transformFrontmatter: 61;
  transformPatch: 1;
  oneSegSkills: 61; // skills/<name>/SKILL.md after targetFor (pstack + 3 team-kit)
  hidden: 57; // disable-model-invocation among one-seg
  loaded: 62; // oneSegSkills + authored create-skill
  tracked: 580; // lockFiles + authored
  invocable: readonly [
    'control-cli',
    'control-ui',
    'create-skill',
    'deslop',
    'setup-pstack',
  ];
}

/** Host map policy for this bump — encode “do nothing” as a type, not a comment. */
export type HostMapChange =
  | { kind: 'none' }
  | {
      kind: 'sections-line';
      /** Only legal when a failing test names the Cursor concept. */
      provenByTest: string;
      line: string;
    };

export interface KetchupVideoHostPolicy {
  /** Forced for Candidate 1: rely on existing ketchup image line + Skipped-in-Pi. */
  proactiveVideoMap: false;
  fallback: 'existing-image-line' | 'skipped-in-pi';
}

export type LadderPhase =
  | 'frame'
  | 'red'
  | 'green'
  | 'script'
  | 'docs'
  | 'verify'
  | 'confirm'
  | 'fact-check';

/** Ordered done-predicate; same spine as parity/pi-pstack-0.15.30/decisions.tsv. */
export interface BumpPlan {
  pin: SourcePin;
  counts: ExpectedCounts;
  targetForUnchanged: true;
  hostMap: HostMapChange; // { kind: 'none' } unless proven
  ketchupVideo: KetchupVideoHostPolicy;
  phases: readonly LadderPhase[]; // fixed order below
}

export const CANDIDATE1_PLAN: BumpPlan = {
  pin: {
    repository: 'https://github.com/cursor/plugins',
    commit: '519d36aa98955bf680db01bcde5fdfba686dc901',
    pstackVersion: '0.15.34',
    teamKitVersion: '1.2.0',
  },
  counts: {
    lockFiles: 579,
    transformNone: 517,
    transformFrontmatter: 61,
    transformPatch: 1,
    oneSegSkills: 61,
    hidden: 57,
    loaded: 62,
    tracked: 580,
    invocable: ['control-cli', 'control-ui', 'create-skill', 'deslop', 'setup-pstack'],
  },
  targetForUnchanged: true,
  hostMap: { kind: 'none' },
  ketchupVideo: { proactiveVideoMap: false, fallback: 'existing-image-line' },
  phases: ['frame', 'red', 'green', 'script', 'docs', 'verify', 'confirm', 'fact-check'],
};

/** Statechart user-facing entry after the mjs→TS rewrite. */
export interface StatechartCliContract {
  /** Relative to skills/statechart/scripts/ */
  bin: 'statechart'; // mode 100755 shell shim
  entryTs: 'statechart.ts';
  usagePrefix: 'Usage: statechart SPEC.tla';
  missingSpec: { status: 2; stderrIncludes: 'Usage: statechart SPEC.tla' };
  /** Old SCRIPT-001 cases that must be deleted, not patched in place blindly. */
  obsolete: readonly ['statechart.mjs --help', 'statechart.mjs from-spec without TLA2TOOLS'];
}
```

## Existing sync surface (unchanged signatures, new pin values)

```js
// scripts/sync-upstream.mjs — public API the bump uses; no new exports required.

/** @type {SourcePin} */
export const SOURCE = {
  repository: 'https://github.com/cursor/plugins',
  commit: '519d36aa98955bf680db01bcde5fdfba686dc901',
  pstackVersion: '0.15.34',
  teamKitVersion: '1.2.0',
};

export const AUTHORED = ['skills/create-skill/SKILL.md'];

/**
 * Maps an upstream path to its place in this package, or undefined when the file does not ship.
 * INVARIANT for Candidate 1: body byte-identical to 0.15.30; do not filter corpus/tests.
 */
export function targetFor(source /*: string */) /*: string | undefined */ {
  throw new Error('not implemented'); // existing body stays; sketch forbids edits
}

export function normalizeFrontmatter(text, directoryName) {
  throw new Error('not implemented');
}

export function applyPatch(text, patch) {
  throw new Error('not implemented');
}

/** Build the full plan from git show at SOURCE.commit. */
export function buildPlan(checkout /*: string */) /*: PlanEntry[] */ {
  throw new Error('not implemented');
  // TODO: assertVersions → sourceEntries(targetFor) → transformEntry → sha256
}

export function lockFor(plan) /*: string */ {
  throw new Error('not implemented');
}

// CLI: --source <checkout> [--check]
// write → 579 files; --check → exit 0 iff disk+lock match plan
```

## Derived helpers (test / operator, not new package modules)

```ts
/**
 * Pure: list of targets that would ship at commit under current targetFor.
 * Used in frame/fact-check; not a second registry—always re-derived from git.
 */
export function deriveShippedTargets(
  checkout: string,
  commit: SourcePin['commit'],
  targetForFn: typeof targetFor,
): string[] {
  throw new Error('not implemented');
  // TODO: git ls-tree -r commit -- pstack cursor-team-kit
  // TODO: filter .DS_Store; map targetFor; drop undefined; sort
}

export function deriveExpectedCounts(
  checkout: string,
  pin: SourcePin,
): ExpectedCounts {
  throw new Error('not implemented');
  // TODO: deriveShippedTargets → length
  // TODO: classify transforms the same way buildPlan does (without writing)
  // TODO: count one-seg SKILL.md + disable-model-invocation via git show
  // TODO: loaded = oneSeg + 1 (create-skill); tracked = lockFiles + 1
}

/**
 * RED→GREEN gate: pins in tests must equal deriveExpectedCounts before SOURCE moves.
 * After GREEN, lock.document must equal those pins.
 */
export function assertLockMatchesCounts(lock: LockDocument, counts: ExpectedCounts): void {
  throw new Error('not implemented');
  // TODO: lock.files.length === counts.lockFiles
  // TODO: histogram(lock.files.map(f => f.transform)) matches none/frontmatter/patch
  // TODO: lock.source deep-equal pin
}

/**
 * Host-gap latch: returns sections change only when a named test fails for a named concept.
 * Default path for ketchup-video: none.
 */
export function decideHostMapChange(evidence: {
  failingHostTest?: string;
  cursorConcept?: string;
}): HostMapChange {
  throw new Error('not implemented');
  // TODO: if !failingHostTest → { kind: 'none' }
  // TODO: else require cursorConcept and draft one Skipped/map line — out of Candidate 1 happy path
}

/** SCRIPT-001 rewrite plan for statechart. */
export function statechartScriptTests(contract: StatechartCliContract): {
  replace: string[];
  withCases: Array<{ name: string; intent: string }>;
} {
  throw new Error('not implemented');
  // TODO: delete obsolete mjs cases
  // TODO: add missing-SPEC → exit 2 + usage
  // TODO: optional: spawn contract.bin -- still SCRIPT-001, no new ID
}
```

## Ladder procedures (operator shell; thin wrappers)

```ts
/** Phase red: update pins only; do not move SOURCE yet. */
export async function phaseRed(plan: BumpPlan): Promise<void> {
  throw new Error('not implemented');
  // TODO: edit test/resources.test.ts ExpectedCounts + SourcePin
  // TODO: edit test/e2e/package.e2e.test.ts skill: length → 62
  // TODO: edit test/e2e/host.e2e.test.ts "Installed skills (62):" (+ ketchup-video in list)
  // TODO: bun run test → expect RED failures naming old 183/61/56
}

/** Phase green: move SOURCE, regenerate, --check. */
export async function phaseGreen(plan: BumpPlan, checkout: string): Promise<void> {
  throw new Error('not implemented');
  // TODO: set SOURCE = plan.pin in sync-upstream.mjs
  // TODO: bun run sync:upstream -- --source checkout
  // TODO: bun run check:upstream -- --source checkout → 579 match
  // TODO: forbid hand edits under skills/ agents/ docs/ automations/ licenses/
}

export async function phaseScript(): Promise<void> {
  throw new Error('not implemented');
  // TODO: rewrite test/scripts.test.ts statechart block per StatechartCliContract
  // TODO: keep describe tag SCRIPT-001
  // TODO: leave poteto 68-pass assertion alone unless it fails; update only if suite count drifts
}

export async function phaseDocs(plan: BumpPlan): Promise<void> {
  throw new Error('not implemented');
  // TODO: package.json version 0.15.34-pi.1; description 0.15.34
  // TODO: README pin, parity pointer to parity/pi-pstack-0.15.34/, Limits for statechart/ketchup-video as needed
  // TODO: root README row if present
}

export async function phaseVerify(): Promise<void> {
  throw new Error('not implemented');
  // TODO: bun run typecheck; bun run test; check:upstream
  // TODO: attribute any root make verify failures to pre-existing vs this change
}

export async function phaseConfirm(): Promise<void> {
  throw new Error('not implemented');
  // TODO: control-pi doctor; skill command list includes statechart + ketchup-video
  // TODO: pi -p smoke /statechart and /ketchup-video
  // TODO: live:e2e scenarios (poteto, delegate, no-comments, setup) with real model
  // TODO: record evidence under parity/pi-pstack-0.15.34/evidence/
}

export async function phaseFactCheck(plan: BumpPlan, checkout: string): Promise<void> {
  throw new Error('not implemented');
  // TODO: independent agent: deriveShippedTargets + sha256 each target after transforms
  // TODO: must not use lock targetSha256 as the sole oracle
  // TODO: confirm create-skill is the only extra file under generated roots
}
```

## Module map

```text
extensions/pi-pstack/
├── scripts/
│   ├── sync-upstream.mjs     # OWN: SOURCE pin, targetFor (UNCHANGED), buildPlan, lockFor, CLI
│   └── patches.json          # OWN: worktree-audit only; no new patch unless --check forces it
├── upstream.lock.json        # GENERATED registry; never hand-edited
├── skills/ … agents/ …       # GENERATED from pin via targetFor (579 paths)
├── skills/create-skill/      # AUTHORED; outside lock
├── src/                      # UNTOUCHED in happy path (HostMapChange.kind === 'none')
│   └── sections.ts           # ketchup image + Skipped-in-Pi already cover ketchup-video
├── test/
│   ├── resources.test.ts     # OWN bump: SourcePin + ExpectedCounts pins (RED then GREEN)
│   ├── scripts.test.ts       # OWN bump: SCRIPT-001 statechart CLI rewrite
│   └── e2e/{package,host}.e2e.test.ts  # OWN bump: loaded skill count 62 strings
├── package.json / README.md  # OWN bump: version + pin docs
└── (no new src modules)

parity/pi-pstack-0.15.34/
├── decisions.tsv             # OWN: frame/red/green/… rows mirroring 0.15.30 ladder
├── evidence/                 # OWN: confirm + TLC/live logs
└── arena/candidate-1/        # this sketch + design.md
```

### Call chain (≤3 hops)

```text
Maintainer
  → sync-upstream.mjs (SOURCE + targetFor + writePlan)
  → upstream.lock.json + tree on disk
  → vitest pins / SCRIPT-001 / confirm scripts

No pass-through layers. No second disposition service.
```

### Data flow

```text
cursor/plugins@519d36aa
  --ls-tree--> source paths
  --targetFor--> ship set (579)
  --git show + transform--> bytes + LockFileEntry
  --writePlan--> package tree + upstream.lock.json
  --loadSkills--> 62 skills (57 hidden)
  --hostSection(facts)--> existing map (no new video line)
```

### Pseudocode: one bump

```
frame: measure tip vs eb4db2b; confirm team-kit 1.2.0; record ExpectedCounts
red:   write pins; tests FAIL
green: SOURCE=tip; sync; --check; tests PASS on resources
script: replace statechart.mjs SCRIPT-001 with statechart bin contract
docs:  0.15.34-pi.1 + README
verify: typecheck + full package test + --check
confirm: control-pi + live e2e + skill smokes
fact-check: independent sha256 re-derive; PASS ⇒ done
if host test fails on ketchup-video concept:
  ONLY THEN HostMapChange.kind = 'sections-line' (scrap happy-path assumption)
```

### Explicit non-modules

- No `CorpusFilter` / `ShippingPolicy` type — filtering lost to keep `targetFor` sole policy.
- No `VideoHostMapper` — Candidate 1 encodes absence.
- No new SCRIPT-002 — obsolete mjs tests rewrite under SCRIPT-001.
```
