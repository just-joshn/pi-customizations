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
