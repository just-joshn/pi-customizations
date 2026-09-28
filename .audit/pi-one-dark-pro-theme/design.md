# pi-one-dark-pro-theme: design and decision trail

Package: `extensions/pi-one-dark-pro-theme`. Branch: `feat/one-dark-pro-theme`.

## Goal

Give Pi 100% parity with the Visual Studio Code theme **One Dark Pro Flat**, with every Pi theme
color traced to a named key or scope in the upstream theme file.

## Source of truth

`https://github.com/Binaryify/OneDark-Pro`, file `themes/OneDark-Pro-flat.json`.
Pinned verbatim at `extensions/pi-one-dark-pro-theme/upstream/OneDark-Pro-flat.json`,
sha256 `e9b4770f83a55891dcd208d7c599f2b0983c07fdcec40301249f50d0e023c656`, 63665 bytes,
246 `colors` keys, 277 `tokenColors` rules, 10 `semanticTokenColors` entries.

Five variants share the in-file name `One Dark Pro`, so the file name is the only unambiguous
identifier. This work pins the `-flat` file.

## The parity problem

Pi's theme schema has 51 required color roles, 5 optional roles, and 3 export colors, a total of
59 assignable values. Upstream has 246 workbench keys and 277 token rules. The work is therefore
not "copy colors". It is deciding, for each of 59 roles, which upstream key or scope is the right
source, and then making that decision mechanical and checkable instead of asserted.

## Mechanism decision

The request said "Pi extension". The package ships no extension code. The evidence:

| Requirement | Owning Pi facility | Evidence |
|---|---|---|
| Assign colors to Pi's UI roles | Theme JSON | `docs/themes.md` "Create a custom theme" |
| Ship the theme to other installs | Pi package, `pi-package` keyword plus `pi.themes` | `docs/packages.md` "Create a package" |
| Contribute theme file paths from code | `resources_discover` returning `themePaths` | `dist/core/extensions/types.d.ts` `ResourcesDiscoverResult` |
| Switch the active theme at runtime | `ctx.ui.setTheme` | `dist/core/extensions/types.d.ts` `ExtensionUIContext` |

`pi.themes` already loads the theme and puts it in `/settings` → Theme, so `resources_discover`
would add nothing. Nothing in the request asks the package to select itself, so `ctx.ui.setTheme`
has no owner. The one gap considered was the upstream 16-color `terminal.ansi*` palette, which
Pi's schema cannot express. That gap cannot reach Pi's UI either: `getTextOutput` in
`dist/core/tools/render-utils.js:32` runs `stripAnsi` and `sanitizeBinaryOutput` over tool output
before rendering, so a terminal palette writer would change the surrounding shell, not Pi.

## Data shape

The mapping is a table, not code. `parity/role-map.tsv` holds 59 rows with five columns:
`role`, `kind`, `source`, `base`, `why`.

Three derivation kinds, each a rule rather than a per-role judgment:

- `color` reads one workbench key verbatim.
- `scope` resolves one TextMate scope against the upstream `tokenColors` rules.
- `composite` flattens a translucent upstream key over the opaque surface VS Code draws it on.

`parity/theme.ts` holds the logic: `parseRoleMap`, `resolveScope`, `resolveRow`, `buildTheme`,
`readThemeSchema`, `themeSchemaPath`, and the `UPSTREAM_SHA256` pin.
`scripts/build-theme.mjs` writes `themes/one-dark-pro-flat.json`. `scripts/check-parity.mjs`
rebuilds in memory and fails on any drift, any missing role, and any role the schema does not
define.

The committed theme is generated, so a hand edit cannot survive the gate.

## Scope resolution

`resolveScope` takes one scope name, walks `tokenColors` in order, splits each rule's `scope`
field on commas, and returns the first matching rule that carries a foreground. It throws when no
rule names the scope.

The first design reproduced VS Code's specificity search: dot-prefix matching plus a
segment-count score with a later-rule tiebreak. That version had a real bug. For the scope
`keyword.operator`, the generic `keyword` rule at index 74 is declared later than the
`keyword.operator` rule at index 71, and equal segment counts let the later rule win, producing
`#c678dd` where the answer is `#abb2bf`.

Exact membership is both simpler and louder. Every `scope` row names a rule verbatim, so
specificity changes no answer, and an unnameable scope becomes a hard failure instead of a silent
prefix match. Both resolvers were run over all 17 scope rows and return identical values.

## Upstream-derived facts that shaped the mapping

- The theme has 13 distinct token foregrounds. Body text has exactly one color, `#abb2bf`.
- Translucency never reaches the theme. 27 upstream keys carry `#RRGGBBAA` and Pi accepts six hex
  digits only, so those keys enter only through `composite`.
- One Dark Pro Flat defines no tinted surface for success or error state. The two tool-state
  backgrounds are therefore flattened from the theme's own insertion and removal tints over the
  editor surface, which is the surface VS Code paints them on.
- `keyword.operator` is not one color upstream. `keyword.operator.assignment` is `#56b6c2` and
  `keyword.operator.word` is `#c678dd`. Pi has one `syntaxOperator` role, so the generic
  `keyword.operator` rule is the representative source. This is recorded as a limit.
- The scrollbar pair was chosen against Pi's built-in dark theme ratios, measured at
  track/page 2.19 and thumb/track 5.44. The selected pair, `editorLineNumber.foreground` and
  `editor.foreground`, gives 1.75 and 3.76. `scrollbarThumb` also matches Pi's documented
  fallback of `text`, so the value keeps Pi's own intent.
- The `selectedBg` composite is `#404859`, which is the same value upstream declares for
  `editor.selectionHighlightBorder` at full opacity. That is a coincidence, not a source, and the
  map records `editor.selectionBackground` as the source.

## Verification leverage

`check:parity` re-derives the theme from the pinned upstream file and the role table and compares
parsed values. It embeds no expected color. Its failures are the deliberate-negative-controls
target: a drifted value, a missing role, an unrecognized role, and a broken upstream pin.

The package is not proven by the gate alone. `test/theme-loader.test.ts` loads the committed theme
through Pi's real `loadThemeFromPath` and asserts rendered escape sequences, so the artifact is
exercised on the surface that consumes it.

## Arena synthesis

Three design runners produced independent sketches. Two delivered:
`/tmp/arena-odpf/candidate-annotated-theme/` and `/tmp/arena-odpf/candidate-declarative-trace/`.

Convergence. Both independently concluded that no extension earns a place, citing the same
`pi.themes` manifest path and the same rejected integration points. Both independently caught an
error in the caller's grounding notes, which had grouped `list.activeSelectionBackground` under
`#2c313c` when upstream has it at `#2c313a`. The upstream file was always the source of truth, so
no value depended on the error.

Base. The caller's table-driven design, which derives the role universe from the installed Pi
schema rather than restating it.

Grafted in.

- Exact-membership scope resolution, from both candidates.
- `upstream/LICENSE`, from `candidate-declarative-trace`. Redistributing the pinned file needs its
  copyright notice.
- `--theme <path>` on the checker, from `candidate-annotated-theme`, so negative controls never
  mutate a tracked file.
- A real-loader test asserting literal ANSI, from both.
- A `test.extend()` temporary-directory fixture for mutation tests, from both.
- A single function that owns the Pi install layout, from `candidate-declarative-trace`.
- Per-problem-code negative controls, from `candidate-annotated-theme`.

Rejected.

- A hand-written `Record<ColorRole, RoleTrace>` for compile-time exhaustiveness, from
  `candidate-annotated-theme`. The role union would restate the schema's role list, which is the
  duplication a schema-driven coverage check avoids.
- A separate `ansi` source kind, from `candidate-annotated-theme`. `terminal.ansi*` keys are
  ordinary workbench keys.
- Allowing `composite` to flatten a scope, from `candidate-declarative-trace`. No row needs it.
- `upstream/pin.json` alongside `upstream/SOURCE.md` and the `UPSTREAM_SHA256` constant. Three
  copies of one fact.
- `src/` as the module home. The package ships no extension, so the mapping and its logic both
  belong under `parity/`.

## Open limits, recorded not hidden

- Pi has one color per syntax concept where upstream varies per language. Nine `syntax*` roles
  carry one representative scope each.
- Pi's schema cannot express italic or bold. Upstream styles comments, headings, and the
  `Functions` rule with font styles that do not survive the port.
- Pi colors have no alpha, so translucent upstream keys are flattened or reduced to their declared
  RGB.
- `thinkingOff` through `thinkingMax` are inferred from the theme's terminal ANSI ladder. VS Code
  has no thinking-level concept, so no direct source exists.
- `mdHr` and `customMessageLabel` have no direct upstream key. Both take a named upstream
  substitute, recorded per row.

## Adversarial review corrections

Two independent reviewers read the branch before the PR. Their findings changed the shipped
palette. The corrections are recorded here because each one is a case where the gate could not
have caught the defect.

- **`mdLink` and `mdLinkUrl` were crossed.** Both reviewers found it. VS Code's markdown grammar
  scopes the visible link text with `string.other.link.title.markdown` and the destination with
  `markup.underline.link.markdown`, so the theme rendered link text purple and the URL blue, the
  reverse of VS Code. Swapped. The gate passed the wrong pairing once the theme was rebuilt,
  which is the clearest demonstration that a consistency gate is not a correctness gate.
- **`userMessageBg` and `customMessageBg` were swapped.** `chat.requestBackground` is VS Code's own
  user-turn surface, so it belongs on the user message role. `customMessageBg` now flattens
  `chat.requestBubbleBackground` over `editor.background` to `#2f343f`, a value an independent
  design runner had also reached.
- **`success` named a gutter background.** `editorGutter.addedBackground` is a marker strip, not a
  text color, and pi's `success` role is a foreground. It now takes
  `chat.linesAddedForeground` `#8cc265`, which also lifts the contrast from 3.81 to 6.68.
- **The scrollbar pair was taste-driven.** The first version used `editorLineNumber.foreground` and
  `editor.foreground`, chosen against pi's built-in theme ratios, while the docs claimed no
  upstream key mapped to those roles. Both halves were wrong. The pair now uses the theme's own
  `scrollbarSlider.background` and `scrollbarSlider.activeBackground`, with the alpha byte
  dropped, and the `alpha` derivation kind exists for it. The pair is quieter than pi's built-in
  theme because One Dark Pro's scrollbar is faint.
- **`mdHr` took an indent guide.** It now takes `menu.separatorBackground`, a key named for a
  separator.
- **The smoke harness claimed isolation it did not implement.** It created a fresh agent directory
  and never passed it, so the package-discovery run could have passed on a theme the operator had
  already copied into `~/.pi/agent/themes`. The harness now sets `HOME`, `PI_CODING_AGENT_DIR`,
  and `PI_OFFLINE`, and a scripted provider drives an offline turn so the user message box and the
  tool box are asserted on the real screen.
- **Five gate branches had no test.** `checkParity` moved into `parity/theme.ts` as a pure function
  over strings, so each problem branch is now a unit test with no CLI and no file mutation.
  `scripts/check-parity.mjs` is a thin shell that reads files and reports.
- **`upstream/SOURCE.md` sent a maintainer to the wrong file** for the hash, and the README claim
  that no extension can select a theme was false. Both corrected.

## Late arena input, and what it did not earn

The third design arena runner settled after the PR opened. Two of its proposals were tested
rather than argued.

**Taken: scope ambiguity fails closed.** The resolver used to take the first rule naming a scope.
That silently returns a plausible color if upstream ever colors one scope from two rules. It now
collects every foreground-carrying rule that names the scope and throws when they disagree. Two
rules that agree are fine, which is how `entity.name.function` resolves today.

**Rejected: a closed `Basis` enum beside each mapping row.** The runner proposed classifying every
row as one of `counterpart`, `content-scope`, `declared-ramp`, `base-text`, or `pi-convention`,
with the enum constrained by the selector kind. The stated purpose was to make a wrong selector
visible in review, which is the defect class that shipped. Tested against that defect:

- `mdLink` and `mdLinkUrl` are both `scope` rows, so `content-scope` is a legal basis for each.
- The defect was choosing the wrong scope for each role, not the wrong kind of basis.
- A kind-constrained enum accepts both crossed rows, so it would have passed the shipped bug.

It is metadata that restates the selector kind without catching the defect that motivated it.
The defense that did work is the one already in the package: a human reading `parity/role-map.tsv`
beside the upstream file. `docs/parity.md` now says plainly that the gate cannot judge which key a
row should name, so a reviewer knows that read is theirs.

**Rejected: a compile-time `satisfies Record<PiColorRole, Provenance>` map.** The role union would
be a hand-maintained copy of Pi's schema, and `checkParity` already compares the map against the
installed schema at runtime. Two gates on one invariant, one of them restating the source of
truth, costs more than it catches.

## The generated-versus-annotated shape fork, tested

The first design arena runner proposed the opposite shape to the one shipped: a hand-authored
theme JSON plus a checker that re-resolves every selector, instead of a generated theme. Both
shapes catch a drifted value, and neither catches a wrong selector, so the fork came down to
failure modes. Tested rather than argued.

Under generation, the gate and the generator share `buildTheme`. A resolver bug changes the
shipped theme and the gate reports OK, because it compares the committed file against a fresh
build from the same broken resolver. Reproduced: with `resolveScope` forced to return `#000000`,
`check:parity` printed OK while all 17 scope-derived roles went black. Under annotation the same
bug is a red build, because the hand-written theme is the fixed side of the comparison.

The generated shape is kept anyway. Authoring is one edit instead of two that must agree, drift
between map and theme is impossible rather than merely detected, and the runner's shape still
relies on the same resolver to check the same selectors.

The self-reference is closed at the boundary it actually matters. Every one of the 17
scope-derived roles is now pinned in `test/theme-loader.test.ts` to the escape it renders,
asserted through pi's own `loadThemeFromPath`, with the expected values taken from the separate
implementation used to derive the palette before this package existed. With the resolver bug
re-injected, 29 tests fail including all 17 pins, while the gate stays green and is documented as
the drift detector it is. The other 42 roles read a workbench key verbatim, so the gate is the
right cover for them.
