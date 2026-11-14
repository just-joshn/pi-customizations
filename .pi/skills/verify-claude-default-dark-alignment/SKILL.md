---
name: verify-claude-default-dark-alignment
description: "Check that pi-claude-default-dark's capture aligner (extensions/pi-claude-default-dark/development/lib/align.ts, with lib/sgr.ts underneath) still points every observation at the right characters, using a fast-check property over generated Pi and Claude Code captures. Use whenever a change touches align.ts, sgr.ts, the capture text format, or anything that computes piAt/claudeAt, before trusting new G4 color-parity numbers, and when a G4 PASS looks suspicious."
---

# Verify the capture aligner

## The property and why it matters

**Property.** Every observation that `align()` reports points at its token, character for character, in both the Pi capture (`piAt`) and the Claude Code capture (`claudeAt`). The Pi cells carry the probe color of the reported role in the reported direction, and every Claude cell resolves to the reported `claude` value.

**Harm when it breaks.** `scripts/compare.ts` reads the colors at `piAt` and `claudeAt` to decide G4. A misplaced coordinate compares the wrong cells. That is how this package once reported exact matches on text that was not the cited token, and how a recolored token still passed (`decisions.tsv`, the `fix` rows after the interrogation). Every color-parity number in `PARITY_REPORT.md` depends on this property.

## Tool, scope, and bounds

- **Tool.** `fast-check` 4.5.3 (the version this repo's other packages use), run by vitest 5.0.2 in `extensions/pi-claude-default-dark/development`. No formal verifier runs on this TypeScript, so the check runs the real `screen()` and `align()` on generated inputs instead of on a hand-written model.
- **What is generated.** Two captures in the exact text format `tmux capture-pane -e -N -p` produces. Each starts with a `SCENE:x` line, then 1–6 lines of 1–4 styled runs. Each line ends with 0–12 spaces of padding, sometimes after a reset and sometimes still in the line's last style, the way `-N` pads every row to the pane width. Run text uses words of 1–6 glyphs drawn from ASCII letters, digits, `_ = (`, CJK `日本語`, precomposed `é`, decomposed `e` + U+0301, `🚀`, `✓`, and `─`. Gaps are `' '`, `'  '`, `' + '`, `' │ '`. Each run has 0–3 SGR codes from: resets `0 39 49 22 23`, `1 2 3`, the probe fg `38;2;1;2;3` and bg `48;2;1;2;3`, truecolor `38;2;248;248;242` and `48;2;2;40;0`, ANSI `34 91`, and 256-color `38;5;174`. A few shared words appear in both captures, so tokens actually match.
- **Bounds.** 5000 cases per run with a fixed seed (`20261113`). A run produces about 28,000 observations, and the test fails if it checks fewer than 5000.
- **Not covered:**
  - Whether tmux's output equals what the apps drew.
  - SGR codes outside the list above. `parseCapture` throws on unknown codes, so a real capture with one fails loudly elsewhere.
  - Whether `parseCapture` keeps characters at their terminal columns. `screen()` and `align()` both read the same parse, so a parse that shifts or drops text stays self-consistent and this property still passes. `tests/sgr.test.ts` covers parse fidelity, including the trailing-blank trimming that `-N` captures need: replacing `trimEnd()` with `trim()` in that loop passes this property and fails the unit tests.
  - `sceneRows`' `CHROME` filter.
  - How `compare.ts` offsets a reviewer pointer inside a token, and its role-only fallback.
  - Whether the mapping reviewers cited the right cells.
  - Inputs larger than the bounds.

  A pass covers the generated space, not every possible capture.

## Coverage record

| Covers | Where |
|---|---|
| `align()`: `piAt` from `runStartCellIndex` plus the token's code-point offset; `claudeAt` from the code-point start of the match; the style read for `claude` | `extensions/pi-claude-default-dark/development/lib/align.ts` |
| `screen()`: `cells`, `lines`, `runStartCellIndex` | `lib/align.ts` |
| `resolve()` for the generated color kinds | `lib/align.ts` |
| `parseCapture()` and `applySgr()` for the generated SGR codes, including inputs with trailing `-N` padding | `lib/sgr.ts` |
| The check | `development/tests/align.property.test.ts` |

**Last confirmed in sync at commit `03bb3943`.** Move this forward only after you confirm the property and generators still describe `align.ts` and `sgr.ts` at the new commit. Find out whether a change touches the covered code with:

```bash
git diff --stat 03bb3943 -- extensions/pi-claude-default-dark/development/lib/align.ts extensions/pi-claude-default-dark/development/lib/sgr.ts extensions/pi-claude-default-dark/development/tests/align.property.test.ts
```

Any output means rerun the check, and reread this record before trusting it.

## Run it

```bash
cd extensions/pi-claude-default-dark/development
bun install --frozen-lockfile   # once per checkout; add --offline to stay off the network once bun's cache has the packages
bun run verify:alignment
```

It takes about 2 seconds. `Tests 1 passed` is a pass. To explore beyond the fixed seed, set `ALIGN_PROPERTY_SEED=<n>` and/or `ALIGN_PROPERTY_RUNS=<n>`. When you find a new counterexample this way, commit it as a plain `test()` beside the property so it stays covered.

## Read a failure

A failure prints a shrunk `Counterexample: [{"piText": ..., "claudeText": ...}]` and the first broken assertion. Read `\u001b[...m` as a color code and `\n` as a line break.

For example, here is what the old bug looks like, from mutating `piAt` back to the start of its run:

```text
piText:  line 1 = probe background, then " é本"
claude:  line 1 = "é本aa"
Pi cells at 1:0 for "é本": expected ' é' to be 'é本'
```

In words: the Pi run starts with a space, the token `é本` starts one cell later, and `align()` pointed at the run's start. So G4 would have compared the space's color, not the token's.

Then decide which kind of failure it is:

- **A real bug.** The counterexample is a capture the apps could produce, meaning SGR codes and characters you also see in `development/captures/*/*.ansi`. Fix `align.ts` or `sgr.ts`, not the test. Then rerun the colour comparison: `node scripts/crosswalk.ts && node scripts/compare.ts && node scripts/report.ts`.
- **A modelling error.** The counterexample needs something a real capture never contains, for example a token that only exists because the generator glued two glyphs together in a way tmux never would. Fix the generator in `tests/align.property.test.ts` and record why in the commit message. Never narrow a generator just to make a failure go away when the input can occur in real captures.

## Update it after an intended change

1. **Changed meaning of `piAt` or `claudeAt`.** Update the assertions so they state the new meaning. Then show the check failing on a scratch break of the new code (the next section) before moving the sync commit.
2. **`sgr.ts` accepts a new SGR code or character class.** Add it to the `sgr` or `glyph` generator so the property exercises it.
3. **New fields on `Observation`.** Assert their meaning too, or list them under "Not covered" above.
4. **Moving the sync commit.** After 1–3, move the sync commit in the coverage record to the commit you checked.

## Scratch-break check (prove it can still fail)

Run this after any edit to the test or the generators:

```bash
cd extensions/pi-claude-default-dark/development
cp lib/align.ts /tmp/align.ts.keep
perl -pi -e 's/\(pi\.runStartCellIndex\.get\(run\) \?\? 0\) \+ \[\.\.\.run\.text\.slice\(0, match\.index\)\]\.length/(pi.runStartCellIndex.get(run) ?? 0)/' lib/align.ts
git diff --stat lib/align.ts        # must show 1 line changed
bun run verify:alignment            # must FAIL with "Pi cells at ..."
cp /tmp/align.ts.keep lib/align.ts
git diff --quiet lib/align.ts && bun run verify:alignment   # clean again, must pass
```

The check has also caught these breaks:

- Using `run.col`, a terminal column, instead of the cell index, which fails on wide characters.
- Reporting `claudeAt` as a UTF-16 index instead of a code-point index, which fails on `🚀` and on decomposed `é`.
