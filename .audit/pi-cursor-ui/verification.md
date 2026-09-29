# pi-cursor-ui verification

Every number below comes from a command run on this machine at this revision.
Anything not measured here is labelled as such.

## Commands

| Check | Command | Result |
|---|---|---|
| Type check | `bun run typecheck` | exit 0 |
| Unit tests | `bun run test` | 14 files, 2328 passed, 2 expected fail, 1 skipped (2331) |
| Skin boundaries | `node scripts/check-skin-boundaries.mjs` | `violations: 0 in 22 source files` |
| Frame invariants | `node scripts/lib/frame-invariants.mjs --self-test` | `15/15 passed` |
| Prompt parity | `node scripts/check-prompt-parity.mjs` | system prompt, 4 tool definitions, and reply identical |
| Reference parity | `node scripts/compare-reference.mjs --known "location PR segment"` | `failures: 0 (declared gaps: 1)` |
| Live matrix | `node scripts/tmux-smoke.mjs --all` | 46 scenarios, 128 steps passed, 0 failures, `invariants: 0 findings, 455 skipped, 922 passed` |
| Reference re-capture | `node scripts/capture-reference.mjs` | reproduced the previous baseline's band, input row, model row, and location row byte for byte |

## What the reference parity check compares

`scripts/compare-reference.mjs` reduces the committed frame
`reference/cursor-agent-2026.09.28-64d2043/01-idle.txt` and a candidate frame to a
skeleton of classified rows, then compares them in order and by indent. Against
the skin as it stood before this work it reported six failures:

```
FAIL row skeleton: reference title < version < tip < band-top < input < band-bottom < model < location
                  but candidate title < title < title < band-top < input < band-bottom < mode < model < location
FAIL tip row present: reference true, candidate false
FAIL banner title indent: reference 2, candidate 0
FAIL banner version row: reference true, candidate false
FAIL footer row order: reference band-bottom < model < location, candidate band-bottom < mode < model < location
FAIL location PR segment: reference shows a PR number, candidate does not
```

After the fix the first five read `ok` and the sixth is reported as a declared
gap, which the `--known` flag prints rather than hides:

```
known location PR segment: reference shows a PR number, candidate does not [declared gap]
failures: 0 (declared gaps: 1)
```

## Evidence limits

- **The baseline was re-captured during this session, not hand-edited.**
  `scripts/capture-reference.mjs` overwrote
  `reference/cursor-agent-2026.09.28-64d2043/` twice, once on purpose and once
  by an accidental import. The first re-capture was diffed against the two
  files it replaced in git: the composer band, the input row, the model row, and
  the location row are byte-identical, and the only differing lines are the
  rotating `Tip:` row and the location's working directory. A third capture,
  checked against what is committed, reports `mismatched states: none` once the
  tip, the location row, the shell prompt above the banner, and trailing pane
  padding are normalised. The two deleted files held a strict subset of the same
  frame.
- The baseline is the idle screen, the slash palette, the `@` palette, shell
  mode, and the mode cycle at 110x34 plus 40x12 and 72x22, all reachable with
  keystrokes alone. No prompt is submitted, so `cursor-agent` spends no model
  request.
- `reference/cursor-agent-2026.09.28-64d2043/transcript/` came from replaying a
  stored chat, which renders assistant prose and tool rows for free. It is
  committed as a frozen baseline; `capture-reference.mjs --transcript`
  regenerates it only when a stored chat exists.
- The tool rows were **not** changed by this work. The replay transcript is the
  spec for them, and the difference is recorded in
  `parity-inventory.md` rather than fixed. The named gaps G4, G5, and G8 there
  are open.
- The rotating `Tip:` row is randomised per launch, so it is compared by shape
  (two-column indent, `Tip: ` prefix) and not by text.
- 455 invariants skipped, up from the previous run. The cause is that
  `mode-line-left-aligned` and `footer-position` are anchored on the
  `shift+tab to cycle` mode row, which the reference shows only after the mode
  changes. Both now skip on an idle frame and run on the `thinking` scenario.
  `footer-position` gained a replacement anchor that needs no mode row: at least
  one non-empty row must render below the composer band. That anchor caught two
  false positives of its own while it was being written, which are fixed.
- Pixel measurements came from the user's recording via `ffmpeg` raw RGB at
  `Screen Recording 2026-09-28 at 7.31.58 PM.mov` timestamps 00:03 and frame
  0:25, and from `Screenshot 2026-09-28 at 7.29.16 PM.jpg`. Band fills are
  quoted as the dominant colour of a run of at least 1000 pixels on one row, and
  the reference band's `#242428` is confirmed independently by the
  `48;2;36;36;40` SGR in `transcript/replay.ansi.txt` line 13.
