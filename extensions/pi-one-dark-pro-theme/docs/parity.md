# Parity report: pi-one-dark-pro-theme

Pi package `extensions/pi-one-dark-pro-theme` (pi 0.87.1) reproduces the Visual Studio Code theme
**One Dark Pro Flat** as a Pi theme. Every value in `themes/one-dark-pro-flat.json` is computed
from the pinned file in `upstream/`, so the theme cannot drift from the source without failing
`npm run check:parity`.

## What a theme file can express

Pi reads a theme JSON, not a VS Code theme. `docs/themes.md` defines five top-level properties:
`$schema`, `name`, `vars`, `colors`, and `export`. `colors` assigns values to interface roles,
and `export` overrides the page, card, and info backgrounds used by HTML export.

The schema defines the exact role set: 51 required color roles, 5 optional color roles
(`scrollbarTrack`, `scrollbarThumb`, `searchMatchBg`, `searchMatchText`, `thinkingMax`), and 3
export colors. `additionalProperties` is false at every level, so a role Pi does not define is a
validation failure rather than a silent extra.

A theme file cannot express:

- **Per-language variation.** VS Code chooses a foreground per TextMate scope path and per
  `semanticTokenColors` entry, so the same role renders differently in different languages. Pi
  has one value per role. Where upstream varies, this package picks the scope the role names and
  records the choice in `parity/role-map.tsv`.
- **Font styles.** Italic and bold live in the same VS Code token rules as color
  (`markup.italic`, `markup.bold` set `fontStyle`). Pi's schema has no font style field, so those
  rules contribute color only.
- **Alpha.** Pi accepts `#rrggbb`, a 256-color index, a `vars` reference, or `""`. There is no
  alpha channel, so every translucent upstream key is flattened over the surface VS Code draws it
  on. The four rows that need this are `selectedBg`, `searchMatchBg`, `toolSuccessBg`, and
  `toolErrorBg`, each composited over `editor.background`.
- **Component identity.** Roles such as `toolPendingBg` or `customMessageLabel` describe Pi
  surfaces that VS Code does not have. Each still names an upstream key or scope, and the reason
  for the pick is the `why` column of the role map.

## How a value is derived

`parity/theme.ts` implements three derivation kinds. `parity/role-map.tsv` assigns one kind to
each of the 59 roles.

| Kind | Rule | Worked example |
|---|---|---|
| `color` | Read `colors[source]` from the upstream file. | `accent` reads `inlineChatInput.focusBorder`, so `#61afef`. |
| `scope` | Resolve `source` as one TextMate scope name against the upstream `tokenColors`. | `syntaxKeyword` resolves the scope `keyword`, which the Keywords rule declares as `#c678dd`. |
| `composite` | Read `colors[source]` and `colors[base]`, then alpha-composite the first over the second. | `toolSuccessBg` flattens `inlineChatDiff.inserted` (`#00809b33`, alpha 51/255) over `editor.background` (`#282c34`): red `0 * 0.2 + 40 * 0.8 = 32`, green `128 * 0.2 + 44 * 0.8 = 61`, blue `155 * 0.2 + 52 * 0.8 = 73`, so `#203d49`. |

`resolveRow` lowercases every result and rejects anything that is not `#rrggbb` or `#rrggbbaa`.

## The scope resolver

`resolveScope` takes one scope name, not a stack. It is exact membership, not a search.

1. Reject a `scopePath` that is empty or holds whitespace. A space-separated value is a
   parent-scope selector, and no row in the map uses one.
2. Walk `tokenColors` in declaration order. A rule's `scope` field may be a string or an array,
   and each entry may be a comma-separated list of names.
3. Return the foreground of the first rule whose name list contains `scopePath` exactly.
4. Throw when no rule names the scope. There is no fallback to `editor.foreground`.

**Why `keyword.operator` wins over `keyword`.** The upstream file declares the rule for
`keyword.operator` at index 71 with foreground `#abb2bf`, then the rule for `keyword` at index 74
with foreground `#c678dd`. Both rules name a string that starts with `keyword`, so a prefix search
would have to choose between them, and a plain last-rule-wins walk would paint every operator
purple. Membership decides it without a search: only the rule that names `keyword.operator`
matches, so `syntaxOperator` resolves to `#abb2bf`, which is also the theme's editor foreground.

Dot-segment specificity is not used, and the spec's question about it is answered by the same
two rules. A specificity resolver scores `keyword.operator` at 2 segments against `keyword` at 1
and picks the same `#abb2bf`, so the added code would change no answer for any of the 17 scope
rows. Exact membership also cannot resolve a scope the theme never names, which would let a typo
in the map pass silently. The failure mode is a thrown error that names the scope instead.

## The 59 rows

Generated from `parity/role-map.tsv` at role map sha256
`2ff418cb78586e8202f6742658187f95eb5ac468e4b92ca0da5c5fdc95ee94c0`. Every value below is also in
`themes/one-dark-pro-flat.json`, and `npm run check:parity` rebuilds the theme and compares.

| Role | Kind | Source | Value |
|---|---|---|---|
| `accent` | color | `inlineChatInput.focusBorder` | `#61afef` |
| `border` | color | `editorGroup.border` | `#23252c` |
| `borderAccent` | color | `panel.border` | `#3e4452` |
| `borderMuted` | color | `editorIndentGuide.background1` | `#343a45` |
| `success` | color | `editorGutter.addedBackground` | `#109868` |
| `error` | color | `editorError.foreground` | `#c24038` |
| `warning` | color | `editorWarning.foreground` | `#d19a66` |
| `muted` | color | `sideBar.foreground` | `#969aa4` |
| `dim` | color | `titleBar.inactiveForeground` | `#6b717d` |
| `text` | color | `editor.foreground` | `#abb2bf` |
| `thinkingText` | color | `gitDecoration.ignoredResourceForeground` | `#636b78` |
| `selectedBg` | composite | `editor.selectionBackground` over `editor.background` | `#404859` |
| `scrollbarTrack` | color | `editorLineNumber.foreground` | `#495162` |
| `scrollbarThumb` | color | `editor.foreground` | `#abb2bf` |
| `searchMatchBg` | composite | `editor.findMatchBackground` over `editor.background` | `#554941` |
| `searchMatchText` | color | `editor.foreground` | `#abb2bf` |
| `userMessageBg` | color | `input.background` | `#21252b` |
| `userMessageText` | color | `input.foreground` | `#abb2bf` |
| `customMessageBg` | color | `chat.requestBackground` | `#2c313c` |
| `customMessageText` | color | `agentsChatInput.foreground` | `#abb2bf` |
| `customMessageLabel` | color | `editorBracketHighlight.foreground2` | `#c678dd` |
| `toolPendingBg` | color | `editorWidget.background` | `#21252b` |
| `toolSuccessBg` | composite | `inlineChatDiff.inserted` over `editor.background` | `#203d49` |
| `toolErrorBg` | composite | `inlineChatDiff.removed` over `editor.background` | `#3f2e36` |
| `toolTitle` | color | `panelTitle.activeForeground` | `#f0f0f0` |
| `toolOutput` | color | `descriptionForeground` | `#abb2bf` |
| `mdHeading` | scope | `markup.heading` | `#e06c75` |
| `mdLink` | scope | `markup.underline.link.markdown` | `#c678dd` |
| `mdLinkUrl` | scope | `string.other.link.title.markdown` | `#61afef` |
| `mdCode` | scope | `markup.inline.raw.markdown` | `#98c379` |
| `mdCodeBlock` | scope | `meta.embedded` | `#abb2bf` |
| `mdCodeBlockBorder` | scope | `punctuation.definition.raw.markdown` | `#e5c07b` |
| `mdQuote` | scope | `markup.quote.markdown` | `#5c6370` |
| `mdQuoteBorder` | color | `textBlockQuote.border` | `#4b5362` |
| `mdHr` | color | `editorIndentGuide.activeBackground1` | `#495169` |
| `mdListBullet` | scope | `punctuation.definition.list.begin.markdown` | `#e5c07b` |
| `toolDiffAdded` | color | `chat.linesAddedForeground` | `#8cc265` |
| `toolDiffRemoved` | color | `chat.linesRemovedForeground` | `#e05561` |
| `toolDiffContext` | color | `sideBar.foreground` | `#969aa4` |
| `syntaxComment` | scope | `comment` | `#7f848e` |
| `syntaxKeyword` | scope | `keyword` | `#c678dd` |
| `syntaxFunction` | scope | `entity.name.function` | `#61afef` |
| `syntaxVariable` | scope | `variable` | `#e06c75` |
| `syntaxString` | scope | `string` | `#98c379` |
| `syntaxNumber` | scope | `constant.numeric` | `#d19a66` |
| `syntaxType` | scope | `entity.name.type` | `#e5c07b` |
| `syntaxOperator` | scope | `keyword.operator` | `#abb2bf` |
| `syntaxPunctuation` | scope | `punctuation.separator.delimiter` | `#abb2bf` |
| `thinkingOff` | color | `terminal.ansiBlack` | `#3f4451` |
| `thinkingMinimal` | color | `terminal.ansiBrightBlack` | `#4f5666` |
| `thinkingLow` | color | `terminal.ansiCyan` | `#42b3c2` |
| `thinkingMedium` | color | `terminal.ansiBlue` | `#4aa5f0` |
| `thinkingHigh` | color | `terminal.ansiMagenta` | `#c162de` |
| `thinkingXhigh` | color | `terminal.ansiBrightMagenta` | `#de73ff` |
| `thinkingMax` | color | `terminal.ansiBrightRed` | `#ff616e` |
| `bashMode` | color | `terminal.ansiGreen` | `#8cc265` |
| `export.pageBg` | color | `editor.background` | `#282c34` |
| `export.cardBg` | color | `editorWidget.background` | `#21252b` |
| `export.infoBg` | color | `editorInlayHint.background` | `#2c313c` |

## Direct keys, token-derived rows, and inferred rows

- **Direct keys, 42 rows.** The 38 `color` rows and the 4 `composite` rows name a key the
  upstream theme authors. A reviewer can open `upstream/OneDark-Pro-flat.json`, search
  `colors[source]`, and see the byte the value came from.
- **Token-derived, 17 rows.** The `scope` rows take the color the upstream theme actually renders
  for a TextMate scope, which is the reason the resolver in `parity/theme.ts` exists. These are
  the rows where "which color does this theme use for X" has an upstream answer that is not a
  workbench key.
- **Inferred, 8 rows.** `thinkingOff` through `thinkingMax` are inferred from the theme's terminal
  accent ladder, because VS Code has no thinking-level concept. `bashMode` uses the same ladder's
  green. The colors are upstream `terminal.ansi*` keys; the mapping from a Pi thinking level or
  shell mode to a ladder step is this package's choice, and it is the one mapping a future Pi
  release could invalidate.

Rows where Pi has no upstream analogue at all, and the key chosen instead: `selectedBg` and
`searchMatchBg` flatten the editor selection and find-match tints onto `editor.background`;
`searchMatchText` and `scrollbarThumb` take `editor.foreground`, matching how Pi documents those
fallbacks; `customMessageLabel` takes the second bracket-pair accent; `toolPendingBg` and the tool
diff backgrounds take the widget and inline-chat surfaces; `mdHr` and `mdQuoteBorder` take the
separator colors.

## Limitations

- **One color per role against per-language upstream values.** `syntaxOperator` is a
  representative choice: the map names the generic `keyword.operator` rule, which renders
  `#abb2bf`. Upstream is not one color there. `keyword.operator.assignment` resolves to
  `#56b6c2` and `keyword.operator.word` resolves to `#c678dd` in the same file, and Pi has one
  operator role. The theme is exact for the scope path named in the map and honest about being a
  single sample elsewhere.
- **No font styles.** Upstream's `markup.italic` and `markup.bold` rules cannot be expressed, so
  italics and bold in Pi remain the terminal's.
- **No alpha.** Pi colors carry no alpha byte, so no tint blends with what is behind it. The map
  composites the four translucent upstream keys onto `editor.background`, the surface VS Code
  draws them on. The upper six digits are not shipped on their own because they would be wrong on
  screen, and the alpha byte is not shipped at all because the schema rejects it.
- **The scrollbar pair is a judgment call.** No upstream key maps to Pi's scrollbar roles, and Pi
  documents `muted` and `text` as their fallbacks. The map takes the dim gutter text for the track
  and the body foreground for the thumb, which keeps the thumb at Pi's documented `text`
  fallback. Pi's built-in dark theme was the tiebreaker: its track-to-page ratio is 2.19 and its
  thumb-to-track ratio is 5.44, against 1.76 and 3.74 for this pair, measured with the same
  formula the contrast table below uses. One Dark Pro's chrome colors sit closer together than
  the built-in theme's, so this pair is quieter on both axes.
- **Tool success and error backgrounds are flat.** `toolSuccessBg` and `toolErrorBg` are tinted
  surfaces, so the foregrounds drawn on them (`toolDiffAdded`, `toolDiffRemoved`) lose the
  contrast they have over the editor surface. The contrast table below shows the measured values.
- **The optional roles are pinned, not inherited.** `scrollbarTrack`, `scrollbarThumb`,
  `searchMatchBg`, `searchMatchText`, and `thinkingMax` have schema fallbacks, and the map assigns
  each one an upstream key instead of leaving the fallback to Pi.

## Contrast

WCAG 2.x relative-luminance ratios, computed from the values in
`themes/one-dark-pro-flat.json`. 4.5 is the AA threshold for body text, 3.0 for large text and
non-text indicators. The package does not assert these numbers; they are here so a reviewer can
see the cost of the flat tints and the quiet tiers.

| Foreground | Background | Ratio |
|---|---|---|
| `text` `#abb2bf` | `userMessageBg` `#21252b` | 7.22 |
| `userMessageText` `#abb2bf` | `userMessageBg` `#21252b` | 7.22 |
| `customMessageText` `#abb2bf` | `customMessageBg` `#2c313c` | 6.11 |
| `toolTitle` `#f0f0f0` | `toolPendingBg` `#21252b` | 13.51 |
| `toolOutput` `#abb2bf` | `toolPendingBg` `#21252b` | 7.22 |
| `muted` `#969aa4` | `userMessageBg` `#21252b` | 5.46 |
| `dim` `#6b717d` | `userMessageBg` `#21252b` | 3.14 |
| `thinkingText` `#636b78` | `userMessageBg` `#21252b` | 2.86 |
| `mdQuote` `#5c6370` | `userMessageBg` `#21252b` | 2.55 |
| `mdHeading` `#e06c75` | `userMessageBg` `#21252b` | 4.82 |
| `mdLink` `#c678dd` | `userMessageBg` `#21252b` | 5.23 |
| `mdLinkUrl` `#61afef` | `userMessageBg` `#21252b` | 6.51 |
| `mdCode` `#98c379` | `userMessageBg` `#21252b` | 7.64 |
| `mdCodeBlock` `#abb2bf` | `userMessageBg` `#21252b` | 7.22 |
| `mdListBullet` `#e5c07b` | `userMessageBg` `#21252b` | 8.91 |
| `syntaxComment` `#7f848e` | `userMessageBg` `#21252b` | 4.10 |
| `syntaxKeyword` `#c678dd` | `userMessageBg` `#21252b` | 5.23 |
| `syntaxFunction` `#61afef` | `userMessageBg` `#21252b` | 6.51 |
| `syntaxVariable` `#e06c75` | `userMessageBg` `#21252b` | 4.82 |
| `syntaxString` `#98c379` | `userMessageBg` `#21252b` | 7.64 |
| `syntaxNumber` `#d19a66` | `userMessageBg` `#21252b` | 6.25 |
| `syntaxType` `#e5c07b` | `userMessageBg` `#21252b` | 8.91 |
| `syntaxOperator` `#abb2bf` | `userMessageBg` `#21252b` | 7.22 |
| `syntaxPunctuation` `#abb2bf` | `userMessageBg` `#21252b` | 7.22 |
| `toolDiffAdded` `#8cc265` | `toolSuccessBg` `#203d49` | 5.49 |
| `toolDiffRemoved` `#e05561` | `toolErrorBg` `#3f2e36` | 3.41 |
| `toolDiffContext` `#969aa4` | `toolPendingBg` `#21252b` | 5.46 |
| `searchMatchText` `#abb2bf` | `searchMatchBg` `#554941` | 4.08 |

The inferred thinking ladder, measured against `userMessageBg` and against the previous step. The
ladder is a visual sequence, not a text scale, so the step ratios matter more than the absolute
ones.

| Role | Value | Ratio to `userMessageBg` | Step from previous |
|---|---|---|---|
| `thinkingOff` | `#3f4451` | 1.58 | n/a |
| `thinkingMinimal` | `#4f5666` | 2.09 | 1.32 |
| `thinkingLow` | `#42b3c2` | 6.20 | 2.96 |
| `thinkingMedium` | `#4aa5f0` | 5.81 | 1.07 |
| `thinkingHigh` | `#c162de` | 4.45 | 1.31 |
| `thinkingXhigh` | `#de73ff` | 5.87 | 1.32 |
| `thinkingMax` | `#ff616e` | 5.27 | 1.11 |
| `bashMode` | `#8cc265` | 7.34 | n/a |

## How to re-verify

```bash
npm run build:theme    # rewrite themes/one-dark-pro-flat.json
npm run check:parity   # pinned hash, role map, schema coverage, committed theme, value shapes
npm run typecheck
npm run test:coverage  # 80% thresholds on parity/*.ts
```

`themeSchemaPath` in `parity/theme.ts` is the only place that knows Pi's install layout, and
`check:parity` reads the schema through it. A Pi upgrade that adds or renames a role fails the
check until the role map gains a row. `check:parity` also accepts `--theme <path>`, which the
mutation tests use to point the gate at a temporary copy instead of the committed file.

`test/parity.test.ts` reads the same artifacts and asserts the committed theme against a fresh
build, so a stale committed file fails the test suite as well. `test/theme-loader.test.ts` loads
the committed theme through Pi's own `loadThemeFromPath` and asserts the truecolor escape
sequences, which is the one check that exercises the artifact on the surface that consumes it.
That suite skips itself when the vendored `@earendil-works/pi-coding-agent` install is absent.
