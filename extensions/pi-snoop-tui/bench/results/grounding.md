# Grounding for a performance hillclimb, 2026-11-15

The goal is a `pi-snoop-tui` that looks modern and measurably beats stock Pi on every user-facing number, using only Pi's documented extension mechanisms. This file records where stock Pi spends work, which of that work an extension can remove, and which numbers no extension can move.

## Verdict

- **Already better than stock (5 of 5 paired rounds each).** Streaming CPU on an empty history is 81 ms lower (247 to 191 ms). On a 150-row history it is 117 ms lower (379 to 240 ms). On a 1050-row session, whole-run CPU is 390 ms lower, restore is 81 ms faster, a resize is 31 ms faster, a storm of five resizes is 27 ms faster, collapsed typing echo is 0.54 ms faster at p50, and a 50-key burst echoes 1.0 ms sooner.
- **Worse than stock.** Empty-session startup costs 8.4 ms more process CPU (paired median, full lower in 0 of 5 rounds). Pi's own timer shows the extension load at 14 ms against 9 ms. The first frame also writes 1311 more bytes, because Pi paints stock chrome before extensions bind and then repaints.
- **No measurable difference.** Streaming echo, clean idle CPU, idle terminal output, Ctrl+O expand, and expanded-state echo. Expanded echo p50 is 0.84 ms higher for full in 4 of 5 rounds, but the ranges overlap.
- **Floor-bound for an extension.** Clean idle (about 0.2 ms of CPU per 10 s and 0 bytes in every configuration), empty-session startup below parity, and echo on a small transcript. The evidence is in [Floor-bound metrics](#floor-bound-metrics).

## Setup

- Apple M4, 10 cores. Pi 1.5.2 on Node v26.13.1. Harness at commit `test(pi-snoop-tui): add startup, typing, idle, and medium-session scenarios`.
- Five interleaved rounds per workload. Each round runs `stock`, `theme`, and `full` once in rotating order. Every run produced a record. None failed or reported problems.
- Commands, run from `bench/`:
  `python3 run.py --workload <startup|stream|medium|long> --runs 5 --out results/grounding-<workload>.jsonl`, then `python3 report.py results/grounding-<workload>.jsonl`.
- Raw data are in [startup](grounding-startup.jsonl), [stream](grounding-stream.jsonl), [medium](grounding-medium.jsonl), [long](grounding-long.jsonl), [uptime](grounding-uptime.txt).

`uptime` before and after each workload:

```
before:        12:32  load averages: 5.24 4.82 6.49
after startup: 12:32  load averages: 4.54 4.69 6.40
after stream:  12:38  load averages: 9.46 5.49 5.94
after medium:  12:45  load averages: 4.98 6.86 6.58
after long:    12:47  load averages: 6.98 6.23 6.32
profiles:      12:47 load averages: 6.66 6.18 6.30, 12:49 load averages: 4.84 5.75 6.11
```

Other work shared the machine, and the sandbox blocks process inspection. Interleaving gives every configuration the same noise. Outliers fall in single rounds of different configurations (for example stock stream round 4 at 538 ms and full long round 2 at 1245 ms).

Three conditions of the harness apply to every configuration and inflate startup:

- The pseudo-terminal does not answer Pi's color and DA1 query, so startup waits the full 100 ms timeout (`TERMINAL_QUERY_TIMEOUT_MS`, `pi-coding-agent/dist/modes/interactive/theme/theme-controller.js:7`, awaited at `interactive-mode.js:744`). A real terminal answers in a few milliseconds.
- `TMUX` is set in the bench environment, so Pi runs `probeTmuxHyperlinks` through `execSync` (`pi-tui/dist/terminal-image.js:20`), 9 ms in the warm startup profile.
- Pi loads `.ts` extensions through jiti with a cache in the temp directory. The first launch in a new temp directory transpiles with Babel. That cold launch cost 150 to 170 ms of extra settle time in the profile jobs (stock 450 then 320 ms, full 429 then 324 ms). Round 0 of the baseline shows the same thing (stock 437 ms, full 384 ms). Medians use the warm rounds.

## Harness changes

`run.py`, `report.py`, `bench-provider.ts`, and `profile-summary.py` gained these measurements. Existing metrics keep their definitions. The long workload's whole-run CPU now includes the new typing and storm steps, so compare it only within this file.

| Measure | Where | What it records |
|---|---|---|
| Empty startup | `--workload startup` | Spawn to first settled frame (500 ms quiet), first-frame bytes, process CPU from `os.wait4` after Ctrl+D right after settle, exit bytes. A second launch with `PI_STARTUP_BENCHMARK=1 PI_TIMING=1` records Pi's own phase timings and per-extension import and factory times. |
| Collapsed typing | `long` | 20 `q` at 100 ms intervals before any Ctrl+O. Echo p50, p95, max, misses. |
| Burst | `long` | 50 `q` written back to back. Time until the whole run of 50 is on screen. |
| Resize storm | `long` | 90, 120, 90, 120, 90 columns back to back, time to settle, and the last rule must be 90 wide. |
| Clean idle | `stream`, `medium` | 10 s after the sampled idle window with the event-loop sampler disabled. CPU, context switches, PTY bytes. |
| Medium session | `--workload medium` | The stream turn on a restored 150-tool-row session of Markdown with headings, lists, tables, and code blocks (`medium-fixture.py`). |
| Profile windows | every record | `windowUs` on Node's `process.hrtime` clock. `profile-summary.py --phase` cuts a profile to any step. |
| Profile buckets | `profile-summary.py` | Self time by owning class (innermost class on the stack, found by matching braces in the minified bundle), inclusive time per class, self time per file, and `--callers`. |

### Sensitivity and work counts

Each new measure separates cases it should separate.

| Measure | Easy case | Hard case | Separates |
|---|---|---|---|
| First settled frame, stock | empty session 284 ms (281..437) | 1050-row restore 429 ms (428..1228) | yes, by session size |
| Echo p50, stock | 0.53 ms streaming on an empty history | 0.92 ms on 150 rows, 2.15 ms collapsed on 1050 rows | yes, by transcript size |
| Resize, stock vs full | full storm 9.6 ms (8.1..20.5) | stock storm 36.4 ms (35.3..37.5) | yes, no range overlap |
| Workload CPU, stock | empty history 247 ms | 150-row history 379 ms | yes, by history size |
| Idle CPU | clean idle 0.22 ms per 10 s | the preceding 10 s with the 10 ms sampler on, 5.4 ms | yes. The clean window resolves about 0.2 ms, so it would show a 10 ms ticker as about 5 ms. |
| Burst | | 3.9 to 4.4 ms, 180 to 360 bytes | The output size fits a single frame, so the step shows coalescing, not a per-key cost. |

Work and error counts across all 60 records follow. Stream and medium runs each had 4 tool results, 0 tool errors, the edit applied, and 0 echo misses. Every long run had 6 steps with output, passed both resize-width checks and the storm's last-rule check, echoed the burst, and missed 0 of 30 typed keys. Every startup run exited with code 0 and printed complete `PI_TIMING` groups.

## Baseline

Median (min..max) of 5 rounds. The paired column is full minus stock in the same round.

| Scenario | Metric | stock | theme | full | full minus stock, paired | full lower |
|---|---|---|---|---|---|---|
| startup | First settled frame ms | 284 (281..437) | 286 (284..288) | 290 (290..384) | 5.6 (-52.5..13.2) | 1/5 |
| startup | Process CPU ms, spawn to exit | 243 (240..399) | 245 (242..246) | 250 (246..409) | 8.4 (1.1..18.6) | 0/5 |
| startup | PI_TIMING extensions TOTAL ms | 9.0 (9.0..10.0) | 9.0 (9.0..11.0) | 14.0 (13.0..16.0) | 4.00 (3.00..7.00) | 0/5 |
| startup | First frame PTY bytes | 2393 (2393..2393) | 2387 (2387..2387) | 3704 (3704..3704) | 1311 (1311..1311) | 0/5 |
| stream | Workload CPU ms | 247 (239..538) | 241 (215..401) | 191 (161..241) | -81 (-297..-54) | 5/5 |
| stream | Echo p50 ms (streaming) | 0.53 (0.42..1.74) | 0.51 (0.44..2.46) | 0.51 (0.46..0.77) | 0.01 (-1.23..0.04) | 2/5 |
| stream | Clean idle CPU ms / 10 s | 0.22 (0.20..0.71) | 0.24 (0.22..0.29) | 0.24 (0.20..0.88) | -0.02 (-0.47..0.69) | 3/5 |
| stream | Clean idle PTY bytes | 0.00 (0.00..0.00) | 0.00 (0.00..0.00) | 0.00 (0.00..0.00) | 0.00 (0.00..0.00) | 0/5 |
| medium | Workload CPU ms | 379 (346..542) | 376 (343..570) | 240 (229..352) | -117 (-190..-53) | 5/5 |
| medium | Echo p50 ms (streaming) | 0.92 (0.77..2.32) | 0.97 (0.68..1.80) | 0.72 (0.65..1.16) | -0.10 (-1.16..0.10) | 4/5 |
| medium | Clean idle CPU ms / 10 s | 0.26 (0.24..0.82) | 0.28 (0.24..0.97) | 0.48 (0.21..1.05) | -0.05 (-0.16..0.81) | 3/5 |
| medium | Clean idle PTY bytes | 0.00 (0.00..0.00) | 0.00 (0.00..0.00) | 0.00 (0.00..0.00) | 0.00 (0.00..0.00) | 0/5 |
| long | Whole-run process CPU ms | 1330 (1290..1863) | 1286 (1281..1299) | 940 (915..1245) | -390 (-619..-359) | 5/5 |
| long | Restore to first frame ms | 429 (428..1228) | 428 (427..437) | 353 (348..358) | -81 (-876..-73) | 5/5 |
| long | Collapsed echo p50 ms | 2.15 (1.91..7.04) | 1.98 (1.87..2.36) | 1.62 (1.54..2.06) | -0.54 (-4.98..-0.37) | 5/5 |
| long | Collapsed echo p95 ms | 3.4 (2.4..14.7) | 2.96 (2.60..3.24) | 2.60 (2.25..4.45) | -1.0 (-10.2..0.2) | 4/5 |
| long | Collapsed echo max ms | 5.1 (4.3..20.5) | 4.52 (4.34..4.96) | 3.85 (3.77..4.47) | -1.3 (-16.1..-0.6) | 5/5 |
| long | Burst of 50 keys ms | 4.4 (3.9..12.6) | 4.24 (4.11..7.21) | 3.9 (3.4..10.5) | -1.02 (-2.17..-0.16) | 5/5 |
| long | Resize 120 to 90 ms | 41 (37..128) | 38.2 (37.3..38.6) | 10.3 (10.1..42.4) | -31.1 (-85.3..-27.1) | 5/5 |
| long | Resize storm (5) ms | 36.4 (35.3..37.5) | 36.0 (34.6..36.5) | 9.6 (8.1..20.5) | -26.7 (-28.3..-17.0) | 5/5 |
| long | Expand ms | 135 (129..147) | 132 (129..135) | 132 (129..365) | 2 (-6..224) | 1/5 |
| long | Expanded echo p50 ms | 3.01 (2.40..3.17) | 2.81 (2.59..2.97) | 3.56 (2.75..8.23) | 0.84 (-0.13..5.05) | 1/5 |

Full report output per workload follows, as printed by `report.py`.

#### startup workload

Median (min..max) per config.

| Metric | stock (n=5, failed=0, problems=0) | theme (n=5, failed=0, problems=0) | full (n=5, failed=0, problems=0) |
|---|---|---|---|
| First settled frame ms | 284 (281..437) | 286 (284..288) | 290 (290..384) |
| First frame PTY bytes | 2393 (2393..2393) | 2387 (2387..2387) | 3704 (3704..3704) |
| Process CPU ms (user+sys), spawn to exit | 243 (240..399) | 245 (242..246) | 250 (246..409) |
| Exit PTY bytes | 1491 (1491..1491) | 1485 (1485..1485) | 1477 (1477..1477) |
| PI_TIMING main TOTAL ms | 157 (157..158) | 157 (156..160) | 161 (160..165) |
| PI_TIMING createAgentSessionRuntime ms | 28 (28..29) | 31 (30..32) | 35 (34..38) |
| PI_TIMING initTheme ms | 8 (8..9) | 8 (8..8) | 8 (7..9) |
| PI_TIMING interactiveMode.init ms | 117 (116..117) | 115 (114..115) | 115 (114..115) |
| PI_TIMING extensions TOTAL ms | 9 (9..10) | 9 (9..11) | 14 (13..16) |
| PI_STARTUP_BENCHMARK process CPU ms | 234 (232..237) | 236 (232..243) | 240 (238..249) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| First settled frame ms | 0 (-149..3), lower 2/5 | 5.6 (-52.5..13.2), lower 1/5 |
| First frame PTY bytes | -6 (-6..-6), lower 5/5 | 1311 (1311..1311), lower 0/5 |
| Process CPU ms (user+sys), spawn to exit | -1 (-153..5), lower 3/5 | 8.4 (1.1..18.6), lower 0/5 |
| Exit PTY bytes | -6 (-6..-6), lower 5/5 | -14 (-14..-14), lower 5/5 |
| PI_TIMING main TOTAL ms | 0 (-1..3), lower 1/5 | 4 (3..8), lower 0/5 |
| PI_TIMING createAgentSessionRuntime ms | 2 (1..4), lower 0/5 | 6 (6..10), lower 0/5 |
| PI_TIMING initTheme ms | 0 (-1..0), lower 1/5 | 0 (-1..1), lower 2/5 |
| PI_TIMING interactiveMode.init ms | -2 (-3..-1), lower 5/5 | -2 (-3..-1), lower 5/5 |
| PI_TIMING extensions TOTAL ms | 0 (-1..2), lower 2/5 | 4 (3..7), lower 0/5 |
| PI_STARTUP_BENCHMARK process CPU ms | 3.2 (-5.2..10.9), lower 1/5 | 5.9 (0.1..17.8), lower 0/5 |

#### stream workload

Median (min..max) per config.

| Metric | stock (n=5, failed=0, problems=0) | theme (n=5, failed=0, problems=0) | full (n=5, failed=0, problems=0) |
|---|---|---|---|
| Workload CPU ms (user+sys) | 247 (239..538) | 241 (215..401) | 191 (161..241) |
| Idle CPU ms over 10 s | 5.43 (4.70..8.05) | 5.62 (5.38..6.27) | 5.6 (4.9..11.9) |
| Workload event-loop delay p50 ms | 10.8 (10.8..11.2) | 10.8 (10.8..11.3) | 11.0 (11.0..11.8) |
| Workload event-loop delay p99 ms | 11.8 (11.6..23.8) | 11.9 (11.6..18.9) | 12.6 (11.7..14.2) |
| Idle event-loop delay p50 ms | 11.0 (11.0..12.0) | 11.0 (11.0..12.0) | 11.0 (11.0..12.0) |
| Idle event-loop delay p99 ms | 11.0 (11.0..12.1) | 11.1 (11.0..12.0) | 11.7 (11.0..14.7) |
| Echo latency p50 ms | 0.53 (0.42..1.74) | 0.51 (0.44..2.46) | 0.51 (0.46..0.77) |
| Echo latency p95 ms | 1.04 (0.90..4.72) | 0.92 (0.78..4.66) | 1.01 (0.70..1.85) |
| Echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| PTY bytes, workload | 301206 (290243..308515) | 290263 (288571..305495) | 290431 (266962..297127) |
| PTY bytes, idle 10 s | 6014 (791..6014) | 788 (788..5999) | 6207 (834..6207) |
| PTY bytes, idle after first 1 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Clean idle CPU ms over 10 s, no sampler | 0.22 (0.20..0.71) | 0.24 (0.22..0.29) | 0.24 (0.20..0.88) |
| Clean idle involuntary context switches | 4 (2..6) | 4 (4..4) | 4 (4..7) |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Tool results | 4 (4..4) | 4 (4..4) | 4 (4..4) |
| Tool errors | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Workload wall ms | 3454 (3422..3759) | 3445 (3438..3660) | 3448 (3418..3583) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| Workload CPU ms (user+sys) | -16 (-296..73), lower 4/5 | -81 (-297..-54), lower 5/5 |
| Idle CPU ms over 10 s | 0.61 (-2.67..0.95), lower 2/5 | 0.92 (-0.90..3.81), lower 2/5 |
| Workload event-loop delay p50 ms | 0.01 (-0.06..0.08), lower 1/5 | 0.24 (0.17..0.58), lower 0/5 |
| Workload event-loop delay p99 ms | 0.2 (-11.1..6.1), lower 2/5 | -0.11 (-9.56..2.13), lower 3/5 |
| Idle event-loop delay p50 ms | 0.00 (0.00..0.01), lower 0/5 | 0.00 (0.00..0.01), lower 0/5 |
| Idle event-loop delay p99 ms | 0.00 (-0.05..0.02), lower 1/5 | 0.01 (-0.01..2.61), lower 1/5 |
| Echo latency p50 ms | 0.03 (-1.14..1.72), lower 2/5 | 0.01 (-1.23..0.04), lower 2/5 |
| Echo latency p95 ms | -0.09 (-3.73..3.21), lower 4/5 | -0.13 (-2.88..0.06), lower 3/5 |
| Echo misses | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| PTY bytes, workload | -10943 (-12300..-812), lower 5/5 | -15326 (-33909..1212), lower 4/5 |
| PTY bytes, idle 10 s | -15 (-5226..-3), lower 5/5 | 193 (-5180..5416), lower 1/5 |
| PTY bytes, idle after first 1 s | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Clean idle CPU ms over 10 s, no sampler | -0.00 (-0.42..0.05), lower 3/5 | -0.02 (-0.47..0.69), lower 3/5 |
| Clean idle involuntary context switches | 0 (-2..2), lower 2/5 | 0 (-2..5), lower 2/5 |
| PTY bytes, clean idle 10 s | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Tool results | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Tool errors | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Workload wall ms | 19 (-174..85), lower 2/5 | -6 (-176..19), lower 4/5 |

#### medium workload

Median (min..max) per config.

| Metric | stock (n=5, failed=0, problems=0) | theme (n=5, failed=0, problems=0) | full (n=5, failed=0, problems=0) |
|---|---|---|---|
| Workload CPU ms (user+sys) | 379 (346..542) | 376 (343..570) | 240 (229..352) |
| Idle CPU ms over 10 s | 6.9 (5.4..17.4) | 11.0 (5.7..17.1) | 10.1 (8.2..19.1) |
| Workload event-loop delay p50 ms | 11.3 (11.2..11.3) | 11.3 (11.2..11.4) | 11.5 (11.1..11.8) |
| Workload event-loop delay p99 ms | 12.8 (12.6..18.4) | 12.7 (12.6..18.5) | 12.9 (12.6..18.5) |
| Idle event-loop delay p50 ms | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) |
| Idle event-loop delay p99 ms | 12.0 (12.0..15.2) | 12.1 (12.0..13.4) | 13.0 (12.0..15.6) |
| Echo latency p50 ms | 0.92 (0.77..2.32) | 0.97 (0.68..1.80) | 0.72 (0.65..1.16) |
| Echo latency p95 ms | 1.38 (1.33..3.86) | 3.31 (0.90..4.88) | 1.25 (1.18..5.18) |
| Echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| PTY bytes, workload | 350500 (335337..361492) | 347095 (333099..365750) | 338641 (335256..339729) |
| PTY bytes, idle 10 s | 6016 (793..6016) | 790 (790..6001) | 834 (834..6207) |
| PTY bytes, idle after first 1 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Clean idle CPU ms over 10 s, no sampler | 0.26 (0.24..0.82) | 0.28 (0.24..0.97) | 0.48 (0.21..1.05) |
| Clean idle involuntary context switches | 4 (2..6) | 4 (2..6) | 6 (4..8) |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Tool results | 4 (4..4) | 4 (4..4) | 4 (4..4) |
| Tool errors | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Workload wall ms | 3566 (3562..3725) | 3552 (3533..3637) | 3583 (3572..3684) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| Workload CPU ms (user+sys) | 11.1 (-8.6..87.6), lower 2/5 | -117 (-190..-53), lower 5/5 |
| Idle CPU ms over 10 s | -0.26 (-1.24..7.17), lower 3/5 | 3.4 (-3.4..12.0), lower 1/5 |
| Workload event-loop delay p50 ms | -0.03 (-0.05..0.02), lower 4/5 | 0.15 (-0.07..0.45), lower 1/5 |
| Workload event-loop delay p99 ms | 0.03 (-0.21..0.57), lower 1/5 | -0.01 (-4.54..5.70), lower 3/5 |
| Idle event-loop delay p50 ms | 0.00 (0.00..0.01), lower 0/5 | 0.00 (0.00..0.01), lower 0/5 |
| Idle event-loop delay p99 ms | 0.00 (-1.78..0.29), lower 1/5 | -0.01 (-1.47..3.55), lower 3/5 |
| Echo latency p50 ms | -0.09 (-0.51..0.26), lower 3/5 | -0.10 (-1.16..0.10), lower 4/5 |
| Echo latency p95 ms | 1.02 (-0.47..2.15), lower 2/5 | -0.18 (-2.14..3.80), lower 4/5 |
| Echo misses | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| PTY bytes, workload | -2238 (-10209..12069), lower 3/5 | -11859 (-25841..4115), lower 4/5 |
| PTY bytes, idle 10 s | -5226 (-5226..5208), lower 4/5 | -5182 (-5182..5414), lower 3/5 |
| PTY bytes, idle after first 1 s | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Clean idle CPU ms over 10 s, no sampler | 0.03 (-0.59..0.70), lower 2/5 | -0.05 (-0.16..0.81), lower 3/5 |
| Clean idle involuntary context switches | 0 (-2..2), lower 1/5 | 2 (0..4), lower 0/5 |
| PTY bytes, clean idle 10 s | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Tool results | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Tool errors | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Workload wall ms | -20.7 (-87.7..2.0), lower 4/5 | 9 (-123..122), lower 1/5 |

#### long workload

Median (min..max) per config.

| Metric | stock (n=5, failed=0, problems=0) | theme (n=5, failed=0, problems=0) | full (n=5, failed=0, problems=0) |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | 1330 (1290..1863) | 1286 (1281..1299) | 940 (915..1245) |
| Collapsed echo latency p50 ms | 2.15 (1.91..7.04) | 1.98 (1.87..2.36) | 1.62 (1.54..2.06) |
| Collapsed echo latency p95 ms | 3.4 (2.4..14.7) | 2.96 (2.60..3.24) | 2.60 (2.25..4.45) |
| Collapsed echo latency max ms | 5.1 (4.3..20.5) | 4.52 (4.34..4.96) | 3.85 (3.77..4.47) |
| Collapsed echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Burst of 50 keys, ms to full echo | 4.4 (3.9..12.6) | 4.24 (4.11..7.21) | 3.9 (3.4..10.5) |
| Burst PTY bytes | 359 (180..360) | 359 (359..360) | 359 (180..359) |
| Burst echoed | 1 (1..1) | 1 (1..1) | 1 (1..1) |
| Expanded echo latency p50 ms | 3.01 (2.40..3.17) | 2.81 (2.59..2.97) | 3.56 (2.75..8.23) |
| Expanded echo latency p95 ms | 3.65 (2.88..9.92) | 3.47 (3.08..5.21) | 4.2 (3.5..11.8) |
| Expanded echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| startup settle ms | 429 (428..1228) | 428 (427..437) | 353 (348..358) |
| narrow settle ms | 41 (37..128) | 38.2 (37.3..38.6) | 10.3 (10.1..42.4) |
| wide settle ms | 41 (39..114) | 39.2 (37.5..39.7) | 8.9 (8.5..18.6) |
| expand settle ms | 135 (129..147) | 132 (129..135) | 132 (129..365) |
| collapse settle ms | 33.5 (32.7..34.3) | 34.6 (33.8..35.6) | 5.4 (5.1..13.0) |
| storm settle ms | 36.4 (35.3..37.5) | 36.0 (34.6..36.5) | 9.6 (8.1..20.5) |
| startup PTY bytes | 12569 (12569..12569) | 12566 (12566..12566) | 11340 (11340..11340) |
| narrow PTY bytes | 5401 (5401..5401) | 5403 (5403..5403) | 4613 (4613..4613) |
| wide PTY bytes | 6731 (6731..6731) | 6728 (6728..6728) | 5295 (5295..5295) |
| expand PTY bytes | 4826 (4826..4826) | 4829 (4829..4829) | 5387 (5387..5387) |
| collapse PTY bytes | 451 (451..451) | 451 (451..451) | 3132 (3132..3132) |
| storm PTY bytes | 5245 (5245..5245) | 5247 (5247..5247) | 4637 (4637..4637) |
| Exit PTY bytes | 1524402 (1524402..1524402) | 1524399 (1524399..1524399) | 478136 (478136..478136) |
| Steps with output | 6 (6..6) | 6 (6..6) | 6 (6..6) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| Process CPU ms (user+sys), whole run | -45 (-582..3), lower 4/5 | -390 (-619..-359), lower 5/5 |
| Collapsed echo latency p50 ms | -0.04 (-5.07..0.34), lower 3/5 | -0.54 (-4.98..-0.37), lower 5/5 |
| Collapsed echo latency p95 ms | -0.1 (-11.7..0.6), lower 4/5 | -1.0 (-10.2..0.2), lower 4/5 |
| Collapsed echo latency max ms | -0.4 (-15.6..0.2), lower 4/5 | -1.3 (-16.1..-0.6), lower 5/5 |
| Collapsed echo misses | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Burst of 50 keys, ms to full echo | -0.24 (-8.53..0.38), lower 3/5 | -1.02 (-2.17..-0.16), lower 5/5 |
| Burst PTY bytes | 0 (0..179), lower 0/5 | 0 (-180..0), lower 1/5 |
| Burst echoed | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| Expanded echo latency p50 ms | -0.15 (-0.36..0.32), lower 4/5 | 0.84 (-0.13..5.05), lower 1/5 |
| Expanded echo latency p95 ms | -0.13 (-4.70..0.48), lower 4/5 | 1.03 (-2.38..8.15), lower 1/5 |
| Expanded echo misses | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |
| startup settle ms | -1 (-801..8), lower 4/5 | -81 (-876..-73), lower 5/5 |
| narrow settle ms | -3.0 (-90.2..-0.1), lower 5/5 | -31.1 (-85.3..-27.1), lower 5/5 |
| wide settle ms | -1.2 (-74.6..-0.3), lower 5/5 | -31.8 (-95.9..-21.3), lower 5/5 |
| expand settle ms | -3.2 (-18.2..5.9), lower 3/5 | 2 (-6..224), lower 1/5 |
| collapse settle ms | 0.38 (0.27..2.90), lower 0/5 | -28.3 (-29.0..-19.7), lower 5/5 |
| storm settle ms | -1.33 (-1.67..0.92), lower 3/5 | -26.7 (-28.3..-17.0), lower 5/5 |
| startup PTY bytes | -3 (-3..-3), lower 5/5 | -1229 (-1229..-1229), lower 5/5 |
| narrow PTY bytes | 2 (2..2), lower 0/5 | -788 (-788..-788), lower 5/5 |
| wide PTY bytes | -3 (-3..-3), lower 5/5 | -1436 (-1436..-1436), lower 5/5 |
| expand PTY bytes | 3 (3..3), lower 0/5 | 561 (561..561), lower 0/5 |
| collapse PTY bytes | 0 (0..0), lower 0/5 | 2681 (2681..2681), lower 0/5 |
| storm PTY bytes | 2 (2..2), lower 0/5 | -608 (-608..-608), lower 5/5 |
| Exit PTY bytes | -3 (-3..-3), lower 5/5 | -1046266 (-1046266..-1046266), lower 5/5 |
| Steps with output | 0 (0..0), lower 0/5 | 0 (0..0), lower 0/5 |


## Profiles

One unreported `--cpu-prof` run per side and scenario, through `NODE_OPTIONS`. `profile-summary.py --record <run> --phase <step>` keeps only the samples inside the step. The startup rows use the second of two launches, so the jiti cache is warm. Samples land about every 1.5 ms under this load, so a single entry below 3 ms is one or two samples. In the bundle, classes `y`, `l`, and `Z` are marked's Tokenizer, Lexer, and Marked instance. `(no class) X` means no class was on the stack and `X` is the leaf file.

Snoop's own code is small in every profile. It took 6.2 ms self at restore of 1050 rows, 1.2 ms over 20 collapsed keystrokes, 1.5 ms in a storm, 7.0 ms in expand, 2.3 ms in a streamed turn, 1.5 ms in a medium streamed turn, and 0 ms in warm startup.

Frames per streamed turn (one `--keep-artifacts` run each, counted from synchronized-output markers) show that stock drew 140 frames and 307 KB, full drew 114 frames and 292 KB.

#### Startup, empty session, warm jiti cache (`startupwarm`, phase `startup`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 290 / 177 | 293 / 184 |
| Self time by owner, ms | (no class) chunk-FF6XOTWB.js 21.0, _InteractiveMode 12.1, (no class) chunk-JXWJOIH4.js 10.5, (no class) node:internal/child_process 9.0, Validator 8.9, (no class) (native) 8.8 | (no class) chunk-FF6XOTWB.js 22.6, _InteractiveMode 15.1, (no class) node:internal/modules/esm/utils 12.0, (no class) chunk-JXWJOIH4.js 10.5, (no class) chunk-VEJDBY3O.js 9.1, (no class) node:internal/child_process 9.0 |
| Inclusive by class, ms | _InteractiveMode 21.1, Validator 10.4, _ModelRuntime 9.3, TuiAltScreen 7.5, _TuiBase 7.4, ModelsImpl 4.5 | _InteractiveMode 18.1, ModelsImpl 9.0, Validator 7.9, _ModelRuntime 7.4, DefaultResourceLoader 7.2, DefaultPackageManager 6.0 |
| Self time by file, ms | chunk-FF6XOTWB.js 30.0, chunk-MMDXLZVS.js 18.8, chunk-VEJDBY3O.js 18.7, node:internal/child_process 18.1, chunk-JXWJOIH4.js 10.5, (native) 10.3 | chunk-FF6XOTWB.js 32.9, chunk-VEJDBY3O.js 25.6, chunk-MMDXLZVS.js 21.3, node:internal/child_process 16.6, node:internal/modules/esm/utils 12.0, chunk-JXWJOIH4.js 10.5 |

#### Streaming turn, empty history (`stream`, phase `workload`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 3488 / 314 | 3431 / 200 |
| Self time by owner, ms | ProcessTerminal 37.7, (no class) node:internal/timers 35.3, Text 28.6, y 19.9, FooterComponent 18.4, TuiAltScreen 18.3 | (no class) node:internal/timers 33.6, TuiAltScreen 26.7, y 19.6, ProcessTerminal 16.6, (no class) node:internal/async_hooks 14.0, OutputAccumulator 11.5 |
| Inclusive by class, ms | _TuiBase 195.8, TuiAltScreen 186.1, Container 125.8, Markdown 46.5, ToolExecutionComponent 44.4, Text 40.3 | _TuiBase 96.1, TuiAltScreen 93.6, Container 48.7, Markdown 38.2, Z 29.1, l 29.1 |
| Self time by file, ms | chunk-FF6XOTWB.js 122.7, (native) 46.3, node:internal/timers 36.7, chunk-VEJDBY3O.js 30.9, chunk-Y55SJART.js 11.4, node:internal/priority_queue 7.6 | chunk-FF6XOTWB.js 66.6, node:internal/timers 33.6, (native) 23.0, chunk-VEJDBY3O.js 15.8, node:internal/async_hooks 14.0, chunk-Y55SJART.js 8.4 |

#### Streaming turn on medium history (`medium`, phase `workload`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 3462 / 370 | 3420 / 176 |
| Self time by owner, ms | Text 57.6, ProcessTerminal 43.0, TuiAltScreen 29.6, (no class) node:internal/timers 23.3, Container 21.5, FooterComponent 19.2 | (no class) node:internal/timers 29.0, y 18.0, TuiAltScreen 12.7, (no class) node:internal/async_hooks 10.2, Markdown 9.6, ProcessTerminal 8.8 |
| Inclusive by class, ms | _TuiBase 250.6, TuiAltScreen 243.9, Container 162.7, ToolExecutionComponent 87.2, Box 73.3, MouseRegion 67.3 | _TuiBase 80.9, TuiAltScreen 77.1, Container 55.6, AssistantMessageComponent 38.3, Markdown 35.3, l 25.8 |
| Self time by file, ms | chunk-FF6XOTWB.js 170.5, chunk-VEJDBY3O.js 55.5, (native) 46.0, node:internal/timers 23.3, node:internal/async_hooks 13.3, node:internal/linkedlist 6.4 | chunk-FF6XOTWB.js 58.8, node:internal/timers 29.1, (native) 16.3, chunk-VEJDBY3O.js 12.4, node:internal/async_hooks 10.2, node:internal/priority_queue 6.6 |

#### Long session, restore to first frame (`long`, phase `startup`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 438 / 321 | 349 / 233 |
| Self time by owner, ms | Text 46.8, ToolExecutionComponent 35.5, (no class) chunk-FF6XOTWB.js 25.6, _InteractiveMode 17.8, Box 17.6, (no class) node:internal/bootstrap/realm 10.6 | (no class) chunk-FF6XOTWB.js 22.5, _InteractiveMode 13.9, ToolExecutionComponent 11.2, y 11.0, (no class) node:internal/modules/esm/utils 9.9, (no class) (native) 9.4 |
| Inclusive by class, ms | _InteractiveMode 123.0, ToolExecutionComponent 116.3, _TuiBase 116.0, Container 111.9, TuiAltScreen 101.3, Box 76.4 | _InteractiveMode 62.9, _TuiBase 47.1, TuiAltScreen 44.1, Container 36.1, ToolExecutionComponent 24.4, Markdown 14.9 |
| Self time by file, ms | chunk-FF6XOTWB.js 130.1, chunk-VEJDBY3O.js 36.7, (native) 21.5, node:path 18.3, chunk-MMDXLZVS.js 16.7, node:internal/child_process 15.5 | chunk-FF6XOTWB.js 59.5, chunk-VEJDBY3O.js 37.4, chunk-MMDXLZVS.js 18.2, node:internal/child_process 17.8, (native) 14.6, node:internal/modules/esm/utils 9.9 |

#### Long session, collapsed typing (20 keys) (`long`, phase `typing`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 2012 / 39 | 2011 / 14 |
| Self time by owner, ms | Container 18.4, Box 10.2, TuiAltScreen 4.5, Spacer 3.0, KeybindingsManager 1.5, (no class) node:internal/timers 1.3 | Container 3.3, TuiAltScreen 3.0, Editor 1.5, AssistantMessageComponent 1.5, MouseRegion 1.5, KeybindingsManager 1.5 |
| Inclusive by class, ms | TuiAltScreen 37.7, _TuiBase 37.7, Container 31.6, ToolExecutionComponent 16.3, Box 10.2, AssistantMessageComponent 7.8 | _TuiBase 13.6, TuiAltScreen 12.1, Container 7.5, AssistantMessageComponent 3.0, StdinBuffer 3.0, ProcessTerminal 3.0 |
| Self time by file, ms | chunk-FF6XOTWB.js 37.6, node:internal/timers 1.3, chunk-4UNPP53I.js 0.0 | chunk-FF6XOTWB.js 9.3, (native) 1.5, chunk-VEJDBY3O.js 1.5, snoop:src/rows/row.ts 1.2 |

#### Long session, burst of 50 keys (`long`, phase `burst`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 6 / 6 | 5 / 5 |
| Self time by owner, ms | KeybindingsManager 3.0, Box 1.5, Spacer 1.5 | KeybindingsManager 1.5, (no class) node:internal/stream_base_commons 1.5, Container 1.5 |
| Inclusive by class, ms | _TuiBase 6.0, TuiAltScreen 4.5, Container 3.0, ToolExecutionComponent 3.0, Box 3.0, KeybindingsManager 3.0 | _TuiBase 3.0, KeybindingsManager 1.5, ProcessTerminal 1.5, StdinBuffer 1.5, CustomEditor 1.5, AssistantMessageComponent 1.5 |
| Self time by file, ms | chunk-FF6XOTWB.js 6.0 | chunk-FF6XOTWB.js 3.0, node:internal/stream_base_commons 1.5 |

#### Long session, resize 120 to 90 (`long`, phase `narrow`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 37 / 36 | 11 / 8 |
| Self time by owner, ms | Text 22.9, Box 7.5, VisualLinePreview 3.0, y 1.5, FooterComponent 0.4, TuiAltScreen 0.3 | Markdown 3.0, l 3.0, Container 1.5 |
| Inclusive by class, ms | _TuiBase 35.6, TuiAltScreen 35.6, Container 35.3, ToolExecutionComponent 32.2, Box 32.2, MouseRegion 27.7 | TuiAltScreen 7.5, Container 7.5, _TuiBase 7.5, Markdown 6.0, UserMessageComponent 4.5, Z 3.0 |
| Self time by file, ms | chunk-FF6XOTWB.js 32.6, (native) 1.5, chunk-VEJDBY3O.js 1.5 | chunk-FF6XOTWB.js 7.5 |

#### Long session, resize storm (`long`, phase `storm`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 36 / 33 | 11 / 11 |
| Self time by owner, ms | Text 19.5, Box 3.0, y 1.5, Markdown 1.5, VisualLinePreview 1.5, ToolExecutionComponent 1.5 | Markdown 3.0, RowHeader 3.0, ProcessTerminal 1.5, (no class) node:internal/bootstrap/switches/is_main_thread 1.5, y 1.5 |
| Inclusive by class, ms | _TuiBase 31.5, Container 31.5, TuiAltScreen 31.5, ToolExecutionComponent 27.0, Box 24.0, MouseRegion 22.5 | TuiAltScreen 9.0, _TuiBase 9.0, Container 7.5, Markdown 4.5, UserMessageComponent 4.5, RowHeader 3.0 |
| Self time by file, ms | chunk-FF6XOTWB.js 27.0, chunk-VEJDBY3O.js 3.0, (native) 1.5, chunk-4UNPP53I.js 1.5 | chunk-FF6XOTWB.js 4.5, (native) 3.0, snoop:src/rows/row.ts 1.5, node:internal/bootstrap/switches/is_main_thread 1.5 |

#### Long session, Ctrl+O expand (`long`, phase `expand`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 138 / 134 | 137 / 131 |
| Self time by owner, ms | Box 41.9, ToolExecutionComponent 32.4, Text 28.4, MultiRegex 9.2, AnsiCodeTracker 9.0, HTMLRenderer 5.8 | Box 30.1, ToolExecutionComponent 28.1, Text 27.1, MultiRegex 18.8, AnsiCodeTracker 8.9, Panel 3.0 |
| Inclusive by class, ms | _TuiBase 133.5, ToolExecutionComponent 132.0, TuiAltScreen 83.7, Container 83.7, Box 80.7, ProcessTerminal 49.8 | _TuiBase 130.8, ToolExecutionComponent 127.7, TuiAltScreen 75.2, Container 73.7, MouseRegion 72.2, RowBody 69.2 |
| Self time by file, ms | chunk-FF6XOTWB.js 97.9, chunk-5AGIVGSV.js 24.5, chunk-VEJDBY3O.js 5.8, (native) 5.3, chunk-4UNPP53I.js 0.0 | chunk-FF6XOTWB.js 87.3, chunk-5AGIVGSV.js 21.0, chunk-VEJDBY3O.js 8.0, (native) 7.5, snoop:src/rows/row.ts 7.0 |

#### Idle after a turn, sampler on (`stream`, phase `idle`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 10000 / 1 | 10001 / 3 |
| Self time by owner, ms | (no class) node:internal/timers 1.3 | ExtensionRunner 1.5, (no class) node:internal/timers 1.3 |
| Inclusive by class, ms | none | AgentSession 1.5, Agent 1.5, ExtensionRunner 1.5 |
| Self time by file, ms | node:internal/timers 1.3 | snoop:bench/bench-provider.ts 1.5, node:internal/timers 1.3 |

#### Clean idle after a turn, sampler off (`stream`, phase `cleanIdle`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 10002 / 3 | 10001 / 0 |
| Self time by owner, ms | (no class) node:internal/process/per_thread 1.5, (no class) node:internal/timers 1.3 | none |
| Inclusive by class, ms | none | none |
| Self time by file, ms | node:internal/process/per_thread 1.5, node:internal/timers 1.3 | none |

#### Clean idle, medium history (`medium`, phase `cleanIdle`)

| | stock | full |
|---|---|---|
| Sampled / busy ms | 10000 / 0 | 10002 / 2 |
| Self time by owner, ms | none | (no class) node:internal/timers 1.5 |
| Inclusive by class, ms | none | none |
| Self time by file, ms | none | node:internal/timers 1.5 |


## How Pi spends the work

Paths are relative to the Pi 1.5.2 install's `node_modules/@earendil-works/`. Pi runs a minified bundle, but these unbundled `dist` files hold the same code with readable line numbers.

**Every frame renders the whole transcript, then paints 40 rows.** Fullscreen mode puts the document container (header, loaded resources, chat) in a `ScrollView` (`pi-coding-agent/dist/modes/interactive/chat-viewport.js:4`, `interactive-mode.js:403-407`). `TuiAltScreen.doRender` calls `renderLayoutFrame` on each frame (`pi-tui/dist/tui-alt-screen.js:1453-1459`). For a scroll node, `layoutComponent` lays out the child with no height limit and calls `renderCached` on it (`pi-tui/dist/layout.js:70-89`). The render cache lives for one frame only (`layout.js:14-27`, `renderCache: new Map()` per frame). `Container.render` calls `render(width)` on every child and copies every line into a new array (`pi-tui/dist/tui.js:138-150`). Only the viewport rows are diffed and written (`tui-alt-screen.js:1479-1556`). So frame cost grows with the number of components and lines in the session, and each component's own cache decides how much. This is why collapsed echo rises from 0.53 ms on an empty history to 2.15 ms on 1050 rows in stock.

**Stock tool rows pay a Box check on every frame.** `ToolExecutionComponent` is a `Container` with a `Spacer` and a `Box` (`pi-coding-agent/dist/modes/interactive/components/tool-execution.js:7-60`). `Box.render` re-renders its children each frame, calls the background function on the string `"test"` to detect theme changes, and compares every child line with its cache (`pi-tui/dist/components/box.js:83-110`). Over 1050 rows that is the stock typing profile: `Container` 18.4 ms and `Box` 10.2 ms self of 39 ms busy. Snoop's rows use `renderShell: 'self'` (`src/rows/row.ts:49`), so the `Box` disappears and full spends 14 ms.

**The stock footer recomputes on every frame.** `FooterComponent.render` has no output cache. It resolves the cwd with `path.resolve` and `path.relative`, formats token counts, and measures widths on each call (`components/footer.js:131-260`). It took 18.4 ms self in a stock streamed turn and 29.0 ms inclusive on the medium history. Snoop's cached footer took 1.5 ms.

**The working indicator is an 80 ms spinner with no elapsed-time text.** `Loader` defaults to 80 ms frames (`pi-tui/dist/components/loader.js:3`, `setInterval` at `:58`) and requests a render on each tick. `WorkingStatusIndicator` adds only colors (`components/status-indicator.js:22-26`). The default editor embeds it in its border (`interactive-mode.js:419`, `embedWorkingStatus: true`), so each tick re-renders the editor and walks the transcript. The loader stops at `agent_end` (`loader.js:32-37`, `interactive-mode.js:3060-3064`). Stock drew 140 frames per streamed turn and full drew 114, and stdout writes took 34.8 ms against 15.1 ms (`writeUtf8String` under `doRender`).

**The editor re-lays out its text on every frame.** `Editor.render` has no render cache and runs `layoutText` on each call (`pi-tui/dist/components/editor.js:397-407`). It cost 15.0 ms inclusive in a stock streamed turn (4.8% of busy) and 4.4 ms in full (2.2%).

**Streaming Markdown is lexed twice per frame.** `Markdown.render` caches by text and width, so any new delta misses and it lexes the whole message again (`pi-tui/dist/components/markdown.js:256-284`). Before that, the transform runs Pi's built-in Mermaid transformer, which is first in the chain (`interactive-mode.js:304-307`, `:1820`). With the default `markdown.mermaid: "streaming"` (`core/settings-manager.js:1135-1137`, `docs/settings.md:116`) it calls `markdownParser.lexer` on the whole message during streaming too (`components/mermaid.js:50-60`). In the full streamed turn, marked's lexer took 29.1 ms inclusive, and 20.1 ms of it ran under the Mermaid transformer. The same transformer lexes every restored message at startup and every message again on each width change, because a width change misses `Markdown`'s cache and reruns the transform.

**Hidden thinking labels and the header cost nothing measurable here.** The hidden-thinking label is a `Text` built once per update (`components/assistant-message.js:136-137`), and the bench has no thinking blocks. The stock header (`BuiltInHeader`, a cached text) took no samples in any profile.

**Tool timers tick only while a tool runs.** Native tool renderers start a 1 s `Elapsed` ticker while a result is partial (`core/tools/render-utils.js:121-130`) and clear it when the result is final. Snoop's compact rows do not call native `renderCall`, so no ticker runs (`src/rows/row.ts:60`).

**Nothing ticks while idle in this setup.** The spinner stops at `agent_end`. The git branch watcher uses `fs.watch` on the HEAD directory (`core/footer-data-provider.js:289`) and polls with `watchFile` only on WSL mounts (`:79-81`, `:303`). The bench cwd is not a git repository. Terminal progress keepalive (`pi-tui/dist/terminal.js:9`, `:499`) runs only with `terminal.showTerminalProgress`, which defaults to off (`docs/settings.md:109`). The clean idle profiles agree: 0 to 3 ms of samples over 10 s in all four runs.

**Startup paints stock chrome before extensions exist.** `init` starts the TUI (`interactive-mode.js:737`), waits for terminal colors (`:744`), checks for `fd` and `rg` with synchronous `which` calls (`:811-812`, 6 ms of `spawnSync` warm), and only then binds extensions (`:820`, which emits `session_start`). Snoop sets its header and footer in `session_start`, so the first full frame shows stock chrome and a second frame repaints row 1 and rows 36 to 40. That is the 1311-byte difference in first-frame bytes. After the color query, `applyTerminalColors` invalidates and re-renders everything (`theme/theme-controller.js:155-170`).

**Each extension entry gets its own jiti instance.** `loadExtensionModule` creates a jiti instance with `moduleCache: false` per extension path (`core/extensions/loader.js:470-490`). The bundled runtime passes `tryNative: false` (`:482`), so `.js` entries also go through jiti. Snoop lists three entries (`package.json` `pi.extensions`), so the shared `src/text.ts` is likely evaluated once per entry. That is an inference from `moduleCache: false`, not a measurement. `PI_TIMING` shows snoop's imports and factories at about 4 to 5 ms warm.


## Ranked hypotheses

The list follows the order of the performance mantras (don't do it, don't do it again, do it less, do it later, do it cheaper). "Stock share" is measured in the profiles and baseline above. "Expected effect" is a guess until a hillclimb step measures it. **Pi-owned** marks a cost no documented extension mechanism can reach.

| # | Mantra | Cost center | Measured share | Native lever | Expected effect (guess) | Risk |
|---|---|---|---|---|---|---|
| 1 | Don't do it | Snoop's own load at startup: three `pi.extensions` entries, each with its own jiti instance (`core/extensions/loader.js:486-488`) | Full costs +8.4 ms process CPU on empty startup (paired, lower 0/5). `PI_TIMING` extensions 14 ms against 9 ms. `createAgentSessionRuntime` +6 ms. | One entry module in `package.json` `pi.extensions` that registers rows, footer, and chrome. Keep factories to handler registration only. | -2 to -5 ms startup CPU. Parity at best, since stock loads nothing here. | Low. Packaging only. Tests can keep importing the modules. |
| 2 | Don't do it | **Pi-owned.** Built-in Mermaid transformer lexes every user and assistant message, during streaming, at restore, and on every width change (`components/mermaid.js:50-60`, first in the chain at `interactive-mode.js:1820`) | 16.8 ms of 314 ms busy (5.4%) in a stock streamed turn. 20.1 ms of 200 ms (10%) in full. Most of the remaining cost of a full resize (lexer frames in `narrow` and `storm`). | None. Extension transformers run after it, and `pi.getSettings()` returns a copy. `markdown.mermaid: "final"` would remove the streaming half, but that changes the user's settings. | | |
| 3 | Don't do it | **Pi-owned.** Startup work before extensions bind: color and DA1 query wait (100 ms in this harness), `which fd` and `which rg` through `spawnSync` (6 ms), tmux probe (9 ms, harness env), module compile, then a first frame with stock chrome and a repaint after `session_start` (`interactive-mode.js:737-820`) | Empty startup settles at 284 ms in stock. Snoop's code takes 0 samples in the warm startup profile. The repaint is +1311 bytes and one frame. | None. `session_start` is the earliest point with `ctx.ui`, and it runs after the first frame. | | |
| 4 | Don't do it again | Re-lexing the whole streaming message on every frame in `Markdown.render` (`pi-tui/dist/components/markdown.js:277-284`) | marked lexer 26.4 ms inclusive of 314 ms busy in stock. About 9.6 ms of that is `Markdown`'s own pass (the rest is Mermaid, item 2). `Markdown` inclusive 46.5 ms (14.8%) stock, 38.2 ms (19%) full. | `pi.registerMarkdownTransformer` for `assistant` text while `isStreaming`: return only the tail from the last top-level block boundary outside a code fence once the text passes a threshold. When streaming ends, Pi re-renders the full text. | -5 to -10 ms per 3 KB turn. Cost grows with the square of message length, so long answers gain more. | Medium to high. While streaming, a user scrolled up sees only the tail. Fences, list numbering, and reference links need care. Mermaid still lexes the full text. |
| 5 | Don't do it again | `Box` shell on tool rows snoop does not cover (`write`, `find`, `ls`, `codemode`, MCP). Each frame calls `bgFn("test")` and compares every child line (`pi-tui/dist/components/box.js:83-110`) | For the four covered tools, `Box` 10.2 ms and `Container` 18.4 ms self of 39 ms busy in stock collapsed typing, against 14 ms total in full. Uncovered tools are not in any fixture, so their share is unmeasured. | `pi.registerToolRenderer` with `renderShell: 'self'` for every remaining built-in tool and an MCP fallback. Add those rows to `medium-fixture.py` first so the step is measurable. | Per-row savings like the 2.15 to 1.62 ms echo change, scaled by how many such rows a session has. | Low. Same pattern as the existing rows. |
| 6 | Do it less | Ctrl+O expand of 1050 rows: every row's native `renderResult` (highlight.js, `Box`, `Text` wrap) runs in the input handler and the next frame | 135 ms in stock, 132 ms in full. Profile: the key-handling path (`StdinBuffer` to `CustomEditor` to `InteractiveMode`) 49.8 ms stock and 55.6 ms full, the frame (`TuiAltScreen`) 83.7 and 75.2 ms, highlight.js `MultiRegex` 9.2 and 18.8 ms. Expanded echo is 0.84 ms higher in full (1 of 5 rounds lower, ranges overlap). | `registerToolRenderer` expanded body drawn by snoop (cached per width, capped lines with a hint, no syntax highlight for `read` and `bash`) instead of delegating to native `renderResult`. | -40 to -80 ms per expand. | Medium. Expanded `read` output would lose syntax highlighting, which works against the modern look. |
| 7 | Do it less | Editor layout on every frame (`pi-tui/dist/components/editor.js:397-407`) | 15.0 ms inclusive in a stock streamed turn (4.8%), 4.4 ms in full (2.2%), 1.5 ms per 20 typed keys in full. | `ctx.ui.setEditorComponent` with a `CustomEditor` subclass that returns cached lines while width, text, cursor, focus, border color, autocomplete, and the embedded status are unchanged. | -3 ms per streamed turn. Nothing for typing, where every frame changes the text. | Medium. Must keep autocomplete, paste markers, cursor marker, and the embedded working status. Conflicts with other extensions that set an editor. |
| 8 | Do it less | **Pi-owned.** Full transcript walk on every frame for user and assistant messages (`pi-tui/dist/tui.js:138-150`, `layout.js:70-89`) | Full collapsed typing: `Container` 3.3 ms and `TuiAltScreen` 3.0 ms self of 14 ms busy for 20 keys. Echo p50 1.62 ms against 0.53 ms on an empty history. | None for message components. Snoop's rows are already one cached line each. | | |
| 9 | Do it later | Snoop row setup at restore. Pi calls `renderCall` and `renderResult` for every row when it builds the transcript (`components/tool-execution.js:210-262`) | Snoop self time 6.2 ms of 233 ms busy at a 1050-row restore (resolver `tool-rows.ts:6` 1.5 ms, `specs.target` 1.5 ms, `tailLines` 1.2 ms). | Inside the existing renderers, compute targets and summaries on the first `render()` of `RowHeader` and `RowBody` instead of in `renderCall` and `renderResult`. | -3 to -6 ms on restore. | Low. |
| 10 | Do it cheaper | Snoop's per-frame and per-resize row work (`RowHeader.render` cache check at `row.ts:140`, `layoutHeader` at `row.ts:93`) | 1.2 ms over 20 collapsed keys, 1.5 ms in a storm, on 1050 rows. | Return the same cached array from `render` and keep one header layout per width. | -1 ms per storm. Marginal. | Low. |
| 11 | Do it cheaper | **Pi-owned.** Stdout write per streaming frame. With the viewport following the end, scrolling changes most rows, and Pi rewrites them (`tui-alt-screen.js:1479-1556`). | `writeUtf8String` 34.8 ms in stock, 15.1 ms in full per streamed turn. Full already draws 114 frames against 140 by using a static indicator. | `setWorkingVisible(false)` would drop the two indicator repaints per turn. Nothing reaches the scroll rewrite. | Under 1 ms. | Low. |

## Floor-bound metrics

These metrics cannot improve through a documented extension mechanism, with the evidence for each.

- **Clean idle CPU and idle output.** 0.22 ms (stock), 0.24 ms (theme), and 0.24 ms (full) of CPU per 10 s after a turn, and 0 PTY bytes in all 30 stream and medium runs. Clean idle profiles hold 0 to 3 ms of samples per 10 s. The source shows no timer left running after `agent_end` (spinner stopped, no elapsed ticker, event-based git watch, progress keepalive off by default). There is nothing left to remove. The sampler idle number (about 5.4 ms) is the sampler itself.
- **Empty-session startup below stock.** The first frame is painted before extensions load (`interactive-mode.js:737` before `:820`). The warm startup profile shows 0 ms in snoop code, and the busy time is Node module compile, Pi init, synchronous `which` calls, and the color query wait. An extension can only add its own load (item 1), so parity is the ceiling.
- **Echo on a small transcript.** Streaming echo p50 is 0.53 ms in stock and 0.51 ms in full (paired +0.01, lower 2 of 5). Pi handles keys with an immediate render that skips the 16 ms throttle (`pi-tui/dist/tui.js:669`, called from `handleTerminalInput` at `:783`). With an almost empty transcript, the remaining time is the PTY round trip and one small frame.
- **Burst echo.** The burst wrote 180 to 360 bytes in every run, which fits a single frame for 50 keys. Full already echoes 1.0 ms sooner than stock. The remaining 3.9 ms is key handling plus one frame of item 8, which is Pi-owned.
- **Ctrl+O expand at the same look.** Both configurations take about 132 ms because both run Pi's native result renderers for 1050 rows. Only a cheaper expanded look (item 6) moves it.

## What these numbers do not cover

- One profile per side and scenario. Per-class times carry about 1.5 ms of sampling granularity.
- Terminal paint time. All latencies stop at the pseudo-terminal.
- Real terminals answer the color query, so real startup is about 100 ms shorter in every configuration.
- No fixture contains `write`, `find`, `ls`, `codemode`, MCP, or thinking blocks, so items 5 and the hidden-thinking label are unmeasured.


## Look and entry, 2026-11-15

Two units ran against this baseline: one extension entry instead of three (hypothesis 1), and variant A of the visual prototypes built into `src/`. Unit 1 was reverted. Unit 2 was kept.

### How these runs were made

The harness was not changed. Each side is a `git archive` copy of the package with its own frozen `bench/run.py`, so the base, Unit 1, and Unit 2 packages could run in alternating order. A driver ran one `run.py --runs 1 --configs stock,full` per side per round, reversed the side order each round, and renumbered `round` so `report.py` pairs stock and full from the same invocation. Every config in a round runs back to back, so `full−stock` is paired within one invocation. The last column compares the two packages' `full` runs from the same round.

The machine was shared with other jobs. Load averages ranged from 3.6 to 24 on 10 cores (`look-uptime.txt`, `final-uptime.txt`). Two earlier Unit 1 startup sets, measured at loads of 8 to 24, were discarded because stock's own extension load swung from 9 to 108 ms. Rounds in a noisy window move both configs, so the paired `full−stock` columns are the primary statistic. The cross-package column is reported, but it is confounded when load changes between invocations.

### Unit 1: one extension entry, reverted

`src/index.ts` called the three default exports and was the only `pi.extensions` entry. Startup workload, 9 interleaved rounds (`quiet-*-startup.jsonl`, load 3.6 to 8.0).

| Metric | quiet-base full−stock | quiet-u1 full−stock | quiet-u1 full − quiet-base full (lower quiet-u1) |
|---|---|---|---|
| First settled frame ms | 9 (-276..328) | 8 (-116..219) | 5 (-93..408), 3/9 |
| First frame PTY bytes | 1311 (1311..1311) | 1311 (1311..1311) | 0 (0..0), 0/9 |
| Process CPU ms (user+sys), spawn to exit | 5 (-187..171) | 10 (-39..156) | 2 (-89..250), 2/9 |
| Exit PTY bytes | -15 (-15..-15) | -15 (-15..-15) | 0 (0..0), 0/9 |
| PI_TIMING main TOTAL ms | 9 (3..314) | 5 (-138..57) | -2 (-317..1), 6/9 |
| PI_TIMING createAgentSessionRuntime ms | 7 (5..279) | 6 (-70..50) | -1 (-245..2), 5/9 |
| PI_TIMING initTheme ms | 0 (-5..11) | -1 (-14..4) | -1 (-16..1), 5/9 |
| PI_TIMING interactiveMode.init ms | -1 (-23..7) | -1 (-41..0) | -1 (-19..1), 5/9 |
| PI_TIMING extensions TOTAL ms | 6 (4..30) | 4 (-9..26) | 0 (-23..3), 4/9 |
| PI_STARTUP_BENCHMARK process CPU ms | 2.5 (-21.5..93.8) | 4 (-224..30) | -37 (-178..9), 7/9 |

Snoop's own import and factory time, summed from `PI_TIMING` entries under `src/`, was 3 ms (2..7) with three entries and 2 ms (2..9) with one. A second set at load 12 (`look-base-startup.jsonl`, `look-u1-startup.jsonl`, 7 rounds) gave 3 ms (2..16) and 2 ms (2..5).

Verdict: no measurable difference. Full−stock process CPU went from 5 ms to 10 ms, `extensions TOTAL` from 6 to 4 ms, and the first settled frame from 9 to 8 ms, all inside run-to-run ranges of ±100 ms or more. The limiter explains it. Snoop's three modules import and run in 2 to 3 ms in total, so one jiti instance per entry can save about 1 ms at most. The rest of full's +5 ms in `extensions TOTAL` and +6 ms in `createAgentSessionRuntime` is not snoop's module load. The commit was dropped, and `package.json` still lists three entries.

### Unit 2: aligned gutter, rule editor, mockup palette, kept

Captures are in `bench/results/visual/final-*.png` (100x40, `snoop-dark`): `collapsed`, `expanded`, and `working` on the full mockup fixture, and `collapsed-short`, `expanded-short`, `collapsed-short-slash`, `collapsed-short-wrap`, and `collapsed-short-bash` on the three-tool fixture. `symmetry.py` on `collapsed-short` gives the same result as prototype A: every non-blank row starts at column 1, and 6 rows end one column from the right edge. In bash mode both rules are `#d6c79c`, the theme's `bashMode`.

The long workload's frozen harness checks that the widest rule after a resize equals the new width. The new editor rules are inset by the gutter, so every `full` long run reports `widest rule 88 != 90`, `118 != 120`, and `last rule 88 != 90` as problems. All runs still recorded every step. The rules were 88 and 118 columns in every run, which is the new width minus two gutters, so each resize re-laid out the frame.

#### Regressions found and fixed before the commit

**Expanded typing.** The first build trimmed blank native lines in a wrapper around each panel's child, on every frame. Native result components return a new array each frame, so every expanded row copied its lines on every frame. Long session, 5 rounds (`look-u1-long.jsonl` against `look-u2-long.jsonl`, load 4.7 to 7.7). Both packages in this set still had Unit 1's single entry, which made no measurable difference:

| Metric | look-u1 full−stock | look-u2 full−stock | look-u2 full − look-u1 full (lower look-u2) |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | -386 (-508..-183) | -299 (-310..-243) | 65.6 (-63.8..80.9), 1/5 |
| Collapsed echo latency p50 ms | -0.83 (-1.28..-0.26) | -0.40 (-0.58..-0.10) | 0.16 (0.03..0.51), 0/5 |
| Expanded echo latency p50 ms | 0.69 (0.12..1.24) | 2.85 (2.37..3.21) | 2.14 (1.29..2.54), 0/5 |
| Expanded echo latency p95 ms | 0.66 (0.10..2.38) | 4.17 (3.73..4.72) | 3.51 (1.13..3.64), 0/5 |

The fix trims inside `Panel` on its cache miss, after `Box` returns its cached array. Expanded echo p50 went from +2.14 ms to +0.21 ms against base (lower in 1 of 6 rounds, range −0.60..2.14).
**Expand.** The blank test then used `stripTerminalSequences`, which cost 8 ms per Ctrl+O over 1050 rows (`isBlank`, `ansiCodeLength`, `visibleWidth` in the expand window, 3 profiles per side at 100 µs sampling). A regex that accepts only spaces and SGR codes replaced it. In 3 more profiles per side, expand-window CPU differs by at most 1 ms per function.

#### Remaining cost: the `›` on user messages

A Markdown line that contains any non-ASCII character takes a slower path in Pi's lexer and width code. A micro-benchmark of 300 user-message `Markdown` renders took 1.0 to 1.2 ms in 4 of 5 warm passes with no transformer, 3.3 to 5.1 ms with `› ` prepended, 3.3 to 3.8 ms with ` ›` appended, and 1.1 to 1.2 ms with the ASCII text `&rsaquo; ` prepended. So the cost comes from the non-ASCII glyph, not from running a transformer. Across two sets of long-workload profiles, `UserMessageComponent` took 6.5 to 6.9 ms more per run and `Markdown` 7.2 to 9.5 ms more, almost all of it in the restore window. Whole-process busy time on warm runs was 491 to 493 ms for base and 507 to 508 ms for Unit 2. The restore settles 10.7 ms later (lower in 0 of 6 rounds) and whole-run CPU is 45 ms higher (8..263, lower in 0 of 6). The profiles explain about 15 ms of that per run. The rest falls in rounds with outliers on both sides. The mockup asks for the glyph, so it stays. Deleting the `registerMarkdownTransformer` line in `src/chrome.ts` would remove this cost.

#### Unit 2 against the package before it

Paired `full−stock` for each package and the direct full-against-full difference. Startup, stream, and medium come from `final-*.jsonl` (7, 5, and 5 rounds, load 4.0 to 6.0 at the start of each workload and 11.7 at the end of medium). Long comes from `recheck2-*.jsonl` (6 rounds, load 4.0 to 4.8), which ran the committed code. The startup, stream, and medium runs used an earlier blank test that only runs when tool rows are expanded, and those workloads never expand them.

Startup:

| Metric | final-base full−stock | final-look full−stock | final-look full − final-base full (lower final-look) |
|---|---|---|---|
| First settled frame ms | 5.9 (-20.9..9.2) | 10.3 (6.5..36.7) | 1.4 (-51.9..9.4), 3/7 |
| First frame PTY bytes | 1312 (1312..1312) | 1342 (1342..1342) | 30 (30..30), 0/7 |
| Process CPU ms (user+sys), spawn to exit | 7.7 (2.8..10.5) | 10.4 (5.1..95.4) | 2.2 (-48.1..21.2), 3/7 |
| PI_TIMING main TOTAL ms | 6 (4..6) | 6 (3..8) | 2 (0..4), 0/7 |
| PI_TIMING extensions TOTAL ms | 5 (3..6) | 6 (5..7) | 1 (-1..3), 1/7 |
| PI_STARTUP_BENCHMARK process CPU ms | 7.1 (0.5..30.8) | 9.8 (-2.3..14.5) | 1.8 (-18.1..10.5), 3/7 |

Stream:

| Metric | final-base full−stock | final-look full−stock | final-look full − final-base full (lower final-look) |
|---|---|---|---|
| Workload CPU ms (user+sys) | -112 (-373..-85) | -81 (-167..-45) | 4.3 (-24.1..36.4), 2/5 |
| Echo latency p50 ms | -0.04 (-1.20..0.03) | -0.06 (-0.12..0.34) | 0.06 (-0.10..0.13), 1/5 |
| Echo latency p95 ms | -0.24 (-4.22..-0.08) | 0.00 (-0.43..0.17) | -0.01 (-0.57..0.24), 3/5 |
| PTY bytes, workload | -10114 (-21535..-5977) | -12051 (-29621..-1078) | -7061 (-13102..19407), 4/5 |
| Clean idle CPU ms over 10 s, no sampler | 0.05 (-0.62..0.06) | 0.00 (-0.05..0.03) | 0.01 (-0.13..0.02), 2/5 |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) | 0 (-4..0), 1/5 |

Medium:

| Metric | final-base full−stock | final-look full−stock | final-look full − final-base full (lower final-look) |
|---|---|---|---|
| Workload CPU ms (user+sys) | -125 (-152..6) | -123 (-129..-20) | -0.3 (-53.7..91.1), 3/5 |
| Echo latency p50 ms | -0.02 (-0.26..1.79) | -0.02 (-0.25..0.51) | -0.01 (-0.50..0.13), 3/5 |
| Echo latency p95 ms | -0.10 (-0.77..6.66) | -0.1 (-0.4..15.2) | 0.1 (-0.5..10.9), 2/5 |
| PTY bytes, workload | 1763 (-15484..5641) | -6201 (-22097..-226) | -4982 (-27508..8111), 3/5 |
| Clean idle CPU ms over 10 s, no sampler | -0.20 (-0.34..-0.06) | -0.05 (-0.87..0.38) | -0.07 (-0.11..0.43), 3/5 |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) | 0 (0..0), 0/5 |

Long session:

| Metric | recheck2-base full−stock | recheck2-look full−stock | recheck2-look full − recheck2-base full (lower recheck2-look) |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | -346 (-444..-271) | -301 (-354..28) | 45 (8..263), 0/6 |
| Collapsed echo latency p50 ms | -0.58 (-1.18..-0.41) | -0.63 (-0.92..2.54) | 0.01 (-0.13..3.05), 3/6 |
| Collapsed echo latency p95 ms | -0.55 (-0.63..0.35) | -0.6 (-1.1..12.7) | -0.2 (-0.9..12.5), 4/6 |
| Burst of 50 keys, ms to full echo | -1.38 (-2.80..0.23) | -0.78 (-4.71..4.89) | 0.2 (-0.3..15.0), 2/6 |
| Expanded echo latency p50 ms | 0.47 (0.16..0.96) | 0.64 (-1.41..1.42) | 0.21 (-0.60..2.14), 1/6 |
| Expanded echo latency p95 ms | 0.71 (-0.14..0.95) | 1.0 (-12.2..2.4) | 0.42 (0.08..6.17), 0/6 |
| startup settle ms | -78.7 (-87.5..-50.6) | -70 (-78..101) | 10.7 (5.8..83.0), 0/6 |
| narrow settle ms | -30.2 (-31.7..-28.9) | -28.0 (-32.0..1.7) | 0.7 (0.1..31.9), 0/6 |
| wide settle ms | -30.5 (-32.3..-29.1) | -30.0 (-31.7..-11.1) | 0.3 (-0.0..24.8), 1/6 |
| expand settle ms | -1.6 (-29.6..2.9) | 8 (1..224) | 8 (-1..293), 1/6 |
| collapse settle ms | -30 (-143..-29) | -29 (-178..-28) | 0.55 (0.08..8.75), 0/6 |
| storm settle ms | -27.6 (-46.3..-27.0) | -26 (-222..-26) | 0.43 (0.11..1.52), 0/6 |

Verdict: no measurable difference on stream, medium, and startup. The full-against-base column stays inside the run-to-run range for every metric. Startup `main TOTAL` (+2 ms) and `interactiveMode.init` (+1 ms) were higher in all 7 rounds, but both are within one millisecond of PI_TIMING's resolution. The first frame writes 30 more bytes and exit writes 56 more, for the gutter spaces and the rule labels. On the long session, collapsed typing, bursts, resizes, and collapse are unchanged. Restore and whole-run CPU are higher, as described above. Expand settles 8 ms later (lower in 1 of 6, range −1..293), while the expand-window CPU profiles match, so that one is inconclusive. Against stock, Unit 2 is still lower on every CPU number and every long-session latency that was lower before. Stream echo p95 moved from −0.24 ms to 0.00 ms against stock, inside its range. Expanded echo was already above stock before Unit 2 (+0.47 ms) and is +0.64 ms now.

#### Stock against full after Unit 2

`report.py` output for the committed look. Startup, stream, and medium come from `final-look-*.jsonl`, and long from `recheck2-look-long.jsonl`.

#### startup workload

Median (min..max) per config.

| Metric | stock (n=7, failed=0, problems=0) | full (n=7, failed=0, problems=0) |
|---|---|---|
| First settled frame ms | 292 (291..361) | 305 (298..398) |
| First frame PTY bytes | 2422 (2422..2422) | 3764 (3764..3764) |
| Process CPU ms (user+sys), spawn to exit | 257 (251..347) | 271 (260..442) |
| Exit PTY bytes | 1520 (1520..1520) | 1533 (1533..1533) |
| PI_TIMING main TOTAL ms | 161 (159..165) | 167 (167..168) |
| PI_TIMING createAgentSessionRuntime ms | 30 (28..31) | 37 (36..38) |
| PI_TIMING initTheme ms | 9 (8..10) | 9 (8..9) |
| PI_TIMING interactiveMode.init ms | 119 (117..120) | 118 (117..119) |
| PI_TIMING extensions TOTAL ms | 10 (9..10) | 15 (14..17) |
| PI_STARTUP_BENCHMARK process CPU ms | 242 (240..251) | 252 (248..260) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | full |
|---|---|
| First settled frame ms | 10.3 (6.5..36.7), lower 0/7 |
| First frame PTY bytes | 1342 (1342..1342), lower 0/7 |
| Process CPU ms (user+sys), spawn to exit | 10.4 (5.1..95.4), lower 0/7 |
| Exit PTY bytes | 13 (13..13), lower 0/7 |
| PI_TIMING main TOTAL ms | 6 (3..8), lower 0/7 |
| PI_TIMING createAgentSessionRuntime ms | 7 (6..8), lower 0/7 |
| PI_TIMING initTheme ms | 0 (-2..1), lower 2/7 |
| PI_TIMING interactiveMode.init ms | -1 (-2..1), lower 5/7 |
| PI_TIMING extensions TOTAL ms | 6 (5..7), lower 0/7 |
| PI_STARTUP_BENCHMARK process CPU ms | 9.8 (-2.3..14.5), lower 1/7 |

#### stream workload

Median (min..max) per config.

| Metric | stock (n=5, failed=0, problems=0) | full (n=5, failed=0, problems=0) |
|---|---|---|
| Workload CPU ms (user+sys) | 279 (252..338) | 175 (172..206) |
| Idle CPU ms over 10 s | 5.0 (4.8..11.9) | 5.4 (4.8..10.4) |
| Workload event-loop delay p50 ms | 11.3 (11.3..11.5) | 11.7 (11.3..11.8) |
| Workload event-loop delay p99 ms | 12.7 (12.6..12.9) | 12.8 (12.6..13.1) |
| Idle event-loop delay p50 ms | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) |
| Idle event-loop delay p99 ms | 12.0 (12.0..13.4) | 12.0 (12.0..12.7) |
| Echo latency p50 ms | 0.53 (0.47..0.63) | 0.54 (0.47..0.83) |
| Echo latency p95 ms | 0.83 (0.74..1.19) | 0.76 (0.74..1.12) |
| Echo misses | 0 (0..0) | 0 (0..0) |
| PTY bytes, workload | 302362 (295920..307873) | 284211 (278252..305562) |
| PTY bytes, idle 10 s | 791 (791..6014) | 841 (841..6214) |
| PTY bytes, idle after first 1 s | 0 (0..0) | 0 (0..0) |
| Clean idle CPU ms over 10 s, no sampler | 0.26 (0.23..0.36) | 0.26 (0.20..0.36) |
| Clean idle involuntary context switches | 4 (4..7) | 4 (4..6) |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) |
| Tool results | 4 (4..4) | 4 (4..4) |
| Tool errors | 0 (0..0) | 0 (0..0) |
| Workload wall ms | 3570 (3550..3582) | 3579 (3552..3590) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | full |
|---|---|
| Workload CPU ms (user+sys) | -81 (-167..-45), lower 5/5 |
| Idle CPU ms over 10 s | 0.17 (-6.74..5.41), lower 2/5 |
| Workload event-loop delay p50 ms | 0.30 (-0.07..0.36), lower 1/5 |
| Workload event-loop delay p99 ms | 0.09 (-0.08..0.24), lower 1/5 |
| Idle event-loop delay p50 ms | 0.00 (0.00..0.01), lower 0/5 |
| Idle event-loop delay p99 ms | 0.00 (-1.40..0.72), lower 1/5 |
| Echo latency p50 ms | -0.06 (-0.12..0.34), lower 3/5 |
| Echo latency p95 ms | 0.00 (-0.43..0.17), lower 2/5 |
| Echo misses | 0 (0..0), lower 0/5 |
| PTY bytes, workload | -12051 (-29621..-1078), lower 5/5 |
| PTY bytes, idle 10 s | 50 (-5173..5423), lower 1/5 |
| PTY bytes, idle after first 1 s | 0 (0..0), lower 0/5 |
| Clean idle CPU ms over 10 s, no sampler | 0.00 (-0.05..0.03), lower 2/5 |
| Clean idle involuntary context switches | 0 (-1..0), lower 1/5 |
| PTY bytes, clean idle 10 s | 0 (0..0), lower 0/5 |
| Tool results | 0 (0..0), lower 0/5 |
| Tool errors | 0 (0..0), lower 0/5 |
| Workload wall ms | 8.1 (-22.6..31.0), lower 2/5 |

#### medium workload

Median (min..max) per config.

| Metric | stock (n=5, failed=0, problems=0) | full (n=5, failed=0, problems=0) |
|---|---|---|
| Workload CPU ms (user+sys) | 354 (346..509) | 225 (223..490) |
| Idle CPU ms over 10 s | 6.6 (6.4..16.2) | 9.6 (5.7..20.7) |
| Workload event-loop delay p50 ms | 11.3 (11.3..11.4) | 11.6 (11.3..11.8) |
| Workload event-loop delay p99 ms | 12.7 (12.6..15.2) | 12.6 (12.6..23.7) |
| Idle event-loop delay p50 ms | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) |
| Idle event-loop delay p99 ms | 12.0 (12.0..14.5) | 12.0 (12.0..14.9) |
| Echo latency p50 ms | 0.81 (0.69..1.43) | 0.73 (0.65..1.94) |
| Echo latency p95 ms | 1.37 (1.07..3.86) | 1.1 (0.9..19.0) |
| Echo misses | 0 (0..0) | 0 (0..0) |
| PTY bytes, workload | 348822 (340688..366264) | 341073 (334868..348596) |
| PTY bytes, idle 10 s | 793 (793..6016) | 841 (841..6214) |
| PTY bytes, idle after first 1 s | 0 (0..0) | 0 (0..0) |
| Clean idle CPU ms over 10 s, no sampler | 0.30 (0.26..1.12) | 0.28 (0.25..0.64) |
| Clean idle involuntary context switches | 4 (4..9) | 4 (3..5) |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) |
| Tool results | 4 (4..4) | 4 (4..4) |
| Tool errors | 0 (0..0) | 0 (0..0) |
| Workload wall ms | 3570 (3567..3605) | 3581 (3558..3935) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | full |
|---|---|
| Workload CPU ms (user+sys) | -123 (-129..-20), lower 5/5 |
| Idle CPU ms over 10 s | 1.36 (-2.90..4.44), lower 2/5 |
| Workload event-loop delay p50 ms | 0.22 (0.05..0.42), lower 0/5 |
| Workload event-loop delay p99 ms | -0.11 (-0.25..8.46), lower 3/5 |
| Idle event-loop delay p50 ms | 0.00 (0.00..0.01), lower 0/5 |
| Idle event-loop delay p99 ms | 0.01 (-0.63..0.47), lower 2/5 |
| Echo latency p50 ms | -0.02 (-0.25..0.51), lower 3/5 |
| Echo latency p95 ms | -0.1 (-0.4..15.2), lower 3/5 |
| Echo misses | 0 (0..0), lower 0/5 |
| PTY bytes, workload | -6201 (-22097..-226), lower 5/5 |
| PTY bytes, idle 10 s | 48 (-5175..5421), lower 1/5 |
| PTY bytes, idle after first 1 s | 0 (0..0), lower 0/5 |
| Clean idle CPU ms over 10 s, no sampler | -0.05 (-0.87..0.38), lower 3/5 |
| Clean idle involuntary context switches | 0 (-5..1), lower 2/5 |
| PTY bytes, clean idle 10 s | 0 (0..0), lower 0/5 |
| Tool results | 0 (0..0), lower 0/5 |
| Tool errors | 0 (0..0), lower 0/5 |
| Workload wall ms | -10 (-31..367), lower 3/5 |

#### long workload

Median (min..max) per config.

| Metric | stock (n=6, failed=0, problems=0) | full (n=6, failed=0, problems=6) |
|---|---|---|
| Process CPU ms (user+sys), whole run | 1304 (1254..1573) | 981 (952..1332) |
| Collapsed echo latency p50 ms | 2.19 (2.13..2.31) | 1.58 (1.39..4.70) |
| Collapsed echo latency p95 ms | 2.82 (2.60..3.09) | 2.2 (2.0..15.6) |
| Collapsed echo latency max ms | 4.71 (4.49..5.14) | 3.9 (3.6..17.6) |
| Collapsed echo misses | 0 (0..0) | 0 (0..0) |
| Burst of 50 keys, ms to full echo | 4.5 (4.0..13.6) | 3.6 (3.5..18.5) |
| Burst PTY bytes | 359 (359..360) | 412 (206..412) |
| Burst echoed | 1 (1..1) | 1 (1..1) |
| Expanded echo latency p50 ms | 2.71 (2.28..7.14) | 3.30 (2.87..5.73) |
| Expanded echo latency p95 ms | 3.4 (3.1..22.5) | 4.4 (4.1..10.4) |
| Expanded echo misses | 0 (0..0) | 0 (0..0) |
| startup settle ms | 437 (431..461) | 363 (358..542) |
| narrow settle ms | 39.7 (37.8..42.5) | 10.6 (10.2..42.0) |
| wide settle ms | 39.8 (38.2..44.9) | 9.0 (8.7..33.8) |
| expand settle ms | 130 (128..205) | 138 (129..428) |
| collapse settle ms | 35 (33..192) | 5.5 (5.2..14.1) |
| storm settle ms | 36 (35..233) | 10.1 (9.7..11.3) |
| startup PTY bytes | 12601 (12601..12601) | 11364 (11364..11364) |
| narrow PTY bytes | 5401 (5401..5401) | 4635 (4635..4635) |
| wide PTY bytes | 6763 (6763..6763) | 5319 (5319..5319) |
| expand PTY bytes | 4826 (4826..4826) | 5500 (5500..5500) |
| collapse PTY bytes | 451 (451..451) | 3107 (3107..3107) |
| storm PTY bytes | 5245 (5245..5245) | 4659 (4659..4659) |
| Exit PTY bytes | 1524440 (1524440..1524440) | 477448 (477448..477448) |
| Steps with output | 6 (6..6) | 6 (6..6) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | full |
|---|---|
| Process CPU ms (user+sys), whole run | -301 (-354..28), lower 5/6 |
| Collapsed echo latency p50 ms | -0.63 (-0.92..2.54), lower 5/6 |
| Collapsed echo latency p95 ms | -0.6 (-1.1..12.7), lower 4/6 |
| Collapsed echo latency max ms | -0.9 (-0.9..12.4), lower 5/6 |
| Collapsed echo misses | 0 (0..0), lower 0/6 |
| Burst of 50 keys, ms to full echo | -0.78 (-4.71..4.89), lower 5/6 |
| Burst PTY bytes | 53 (-154..53), lower 1/6 |
| Burst echoed | 0 (0..0), lower 0/6 |
| Expanded echo latency p50 ms | 0.64 (-1.41..1.42), lower 1/6 |
| Expanded echo latency p95 ms | 1.0 (-12.2..2.4), lower 1/6 |
| Expanded echo misses | 0 (0..0), lower 0/6 |
| startup settle ms | -70 (-78..101), lower 5/6 |
| narrow settle ms | -28.0 (-32.0..1.7), lower 5/6 |
| wide settle ms | -30.0 (-31.7..-11.1), lower 6/6 |
| expand settle ms | 8 (1..224), lower 0/6 |
| collapse settle ms | -29 (-178..-28), lower 6/6 |
| storm settle ms | -26 (-222..-26), lower 6/6 |
| startup PTY bytes | -1237 (-1237..-1237), lower 6/6 |
| narrow PTY bytes | -766 (-766..-766), lower 6/6 |
| wide PTY bytes | -1444 (-1444..-1444), lower 6/6 |
| expand PTY bytes | 674 (674..674), lower 0/6 |
| collapse PTY bytes | 2656 (2656..2656), lower 0/6 |
| storm PTY bytes | -586 (-586..-586), lower 6/6 |
| Exit PTY bytes | -1046992 (-1046992..-1046992), lower 6/6 |
| Steps with output | 0 (0..0), lower 0/6 |


## Generic rows, 2026-11-15

One unit ran against the look above: compact rows for tools with no renderer of their own (hypothesis 5, uncovered tools). It was kept.

### What Pi does with these tools

`registerToolRenderer`'s `next()` returns one of two things for a tool that ships no renderer. When the tool is registered, as pstack registers `codemode`, `pi_spawn`, and `tmux_run`, `next()` returns the tool definition with no `renderCall` or `renderResult`. `ToolExecutionComponent` then draws a padded `Box` holding the tool name with its arguments (`formatToolCallWithArgs`, collapsed to 100 characters) and the first 10 lines of output with a "more lines" hint (`components/tool-execution.js:96-115`, `:236-276`). When the tool is not registered at all (filtered out by `--tools`, or an MCP tool before its server connects), `next()` returns `undefined` and the row is a `Text` with the name, the pretty-printed JSON arguments, and the complete output (`formatToolExecution`, `:343-354`). Snoop now replaces both: the resolver in `src/tool-rows.ts` returns `compactRenderers(genericSpec(name), {})` whenever `next()` has neither renderer, and returns `next()` untouched when it has either.

### Change

- `genericSpec(toolName)` in `src/rows/specs.ts` is the registry's fallback entry. Its verb is the tool name. Its target is the first of `command`, `path`, `code`, `brief`, `name`, `query`, `url` that holds a string, else the first string argument, cut to its first line. Its meta is `N lines`, `image`, `failed`, or `exit N` when a failed output ends in `exit code N`. Failures show the same 5-line head preview as `read`.
- `compactRenderers` draws the expanded body of a tool with no native `renderResult` as a `Text` in the existing panel: the compact JSON arguments in `dim`, a blank line, and the sanitized output. `Text` caches its wrap by width, so the panel's identity check hits on every later frame.
- `layoutHeader` pads the verb to the verb column and then always adds two spaces, so a verb longer than the column (`codemode`, `pi_spawn`, `tmux_run`) keeps its gap.

### How these runs were made

`--workload mixed` restores 300 tool rows, half of them `codemode`, `pi_spawn`, and `tmux_run` registered without renderers by `bench-provider.ts` and enabled through `--tools`, so both configs take the registered-tool path above. The long workload's rule check now accepts rules inset by the editor gutter, so `full` long runs no longer report problems. Neither change touches what is measured.

Each side is a copy of the package with the same frozen `bench/` (base: the `test(pi-snoop-tui): add mixed-tool session workload` commit, generic: base plus this change). A driver ran `run.py --runs 1` per side per round, swapped the side order and the config order (`stock,full` or `full,stock`) every round, and renumbered `round`. Five rounds of `mixed`, then five of `long`. Load average was 3.3 to 4.2 on 10 cores throughout (`generic-uptime.txt`). All 40 runs finished with no problems and 6 steps with output. Records are in `generic-{base,after}-{mixed,long}.jsonl`.

### Result

Mixed session, medians (min..max) over 5 runs:

| Metric | stock | full before | full after |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | 1019 (1012..1151) | 946 (910..1133) | 700 (698..895) |
| Collapsed echo latency p50 ms | 1.19 (1.05..1.32) | 1.05 (1.00..1.07) | 0.82 (0.71..1.01) |
| Expanded echo latency p50 ms | 1.51 (1.39..1.77) | 1.90 (1.74..2.22) | 1.33 (1.24..1.55) |
| startup settle ms | 379 (377..502) | 373 (372..473) | 343 (338..445) |
| narrow settle ms | 24.3 (23.9..24.6) | 19.2 (18.1..19.7) | 5.89 (5.57..6.09) |
| expand settle ms | 179 (177..184) | 185 (180..190) | 152 (151..156) |
| collapse settle ms | 23.3 (22.3..23.4) | 16.1 (15.8..16.8) | 2.44 (2.29..2.73) |
| storm settle ms | 23.1 (21.6..23.3) | 16.7 (16.3..17.1) | 5.08 (4.93..5.58) |
| startup PTY bytes | 13356 | 15282 | 11048 |
| Exit PTY bytes | 624358 | 458869 | 117657 |

The stock column comes from the base invocations. Stock in the generic invocations had identical bytes and timing medians within 6%, with whole-run CPU within 0.2%.

Paired by round. The first two columns are `full − stock` inside one invocation. The last is generic `full` minus base `full` from the same round, with the rounds where generic was lower.

| Metric | base full−stock | generic full−stock | generic full − base full (lower generic) |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | -66 (-113..-19) | -312 (-325..-199) | -233 (-257..-210), 5/5 |
| Collapsed echo latency p50 ms | -0.17 (-0.27..0.00) | -0.30 (-0.50..-0.22) | -0.25 (-0.34..0.01), 4/5 |
| Collapsed echo latency p95 ms | -0.10 (-0.41..0.40) | -0.35 (-0.55..0.23) | -0.14 (-0.47..0.01), 4/5 |
| Burst of 50 keys, ms to full echo | -0.17 (-0.82..0.06) | -0.38 (-0.55..-0.14) | -0.27 (-0.39..-0.05), 5/5 |
| Expanded echo latency p50 ms | 0.30 (0.15..0.59) | -0.23 (-0.40..0.17) | -0.49 (-0.89..-0.37), 5/5 |
| Expanded echo latency p95 ms | 0.06 (-0.37..0.64) | -0.44 (-0.59..-0.13) | -0.62 (-0.82..-0.30), 5/5 |
| startup settle ms | -7.3 (-29.0..-0.7) | -35.5 (-44.6..8.7) | -28.9 (-39.3..-27.5), 5/5 |
| narrow settle ms | -5.08 (-5.77..-4.93) | -19.2 (-19.6..-18.5) | -13.4 (-13.6..-12.5), 5/5 |
| wide settle ms | -6.26 (-6.45..-5.19) | -18.4 (-19.1..-18.0) | -12.4 (-12.6..-11.9), 5/5 |
| expand settle ms | 5.9 (0.2..10.4) | -28.5 (-33.0..-25.0) | -32.2 (-37.6..-28.9), 5/5 |
| collapse settle ms | -6.80 (-7.28..-6.52) | -20.9 (-21.1..-20.4) | -13.6 (-14.2..-13.3), 5/5 |
| storm settle ms | -6.41 (-6.75..-5.33) | -18.5 (-18.7..-16.8) | -11.4 (-12.0..-11.0), 5/5 |
| startup PTY bytes | 1926 | -2308 | -4234, 5/5 |
| narrow PTY bytes | 102 | -1347 | -1449, 5/5 |
| wide PTY bytes | 96 | -1756 | -1852, 5/5 |
| expand PTY bytes | 271 | 248 | -23, 5/5 |
| collapse PTY bytes | 1292 | -449 | -1741, 5/5 |
| storm PTY bytes | 111 | -1257 | -1368, 5/5 |
| Exit PTY bytes | -165489 | -506701 | -341212, 5/5 |

Long session, the regression check:

| Metric | base full−stock | generic full−stock | generic full − base full (lower generic) |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | -350 (-367..-323) | -352 (-371..-322) | -1.8 (-18.8..12.2), 3/5 |
| Collapsed echo latency p50 ms | -0.46 (-0.61..-0.05) | -0.83 (-1.17..-0.57) | 0.00 (-0.67..0.10), 2/5 |
| Burst of 50 keys, ms to full echo | -0.81 (-1.47..-0.25) | -0.48 (-0.61..-0.17) | 0.07 (-0.41..0.67), 2/5 |
| Expanded echo latency p50 ms | 0.29 (-0.18..0.53) | 0.61 (0.33..0.73) | 0.08 (-0.39..0.65), 2/5 |
| startup settle ms | -73.9 (-82.6..-68.1) | -70.4 (-75.0..-66.0) | 1.71 (-1.87..3.41), 1/5 |
| narrow settle ms | -29.9 (-30.2..-27.9) | -30.4 (-31.3..-29.5) | -0.09 (-0.15..0.13), 3/5 |
| wide settle ms | -31.0 (-32.9..-30.7) | -30.5 (-31.9..-28.9) | 0.07 (0.04..0.41), 0/5 |
| expand settle ms | -1.75 (-2.82..0.47) | -0.71 (-3.76..7.63) | 0.16 (-2.79..2.87), 2/5 |
| collapse settle ms | -28.6 (-29.7..-26.8) | -27.2 (-28.8..-27.1) | 0.28 (-0.39..0.48), 2/5 |
| storm settle ms | -27.6 (-27.9..-25.7) | -27.4 (-27.5..-26.4) | -0.15 (-0.35..0.25), 4/5 |
| PTY bytes, every step and exit | identical | identical | 0 (0..0) |

Verdict: faster on the mixed session, no measurable difference on the long session. Mixed whole-run CPU went from 946 to 700 ms (−233 ms paired, lower in 5 of 5 rounds, range −257..−210, outside base full's run-to-run spread). Against stock, full now saves 312 ms instead of 66. Resize, collapse, and storm settle in 5 to 6 ms instead of 16 to 19, and expanded typing went from 0.30 ms slower than stock to 0.23 ms faster. Exit bytes fell by 341 KB because each generic row prints one line instead of up to 13. The long fixture has no renderer-less tools, its bytes are identical in every step, and every timing difference sits inside its range.

The limiter, from one unreported `--cpu-prof` run per side on the mixed session: in base full's storm window, `ToolExecutionComponent` and `Box` held 13.5 ms of 18 ms busy, with `Text` (rewrapping the fallback output) 7.5 ms self. In the generic run the storm window held 3 ms busy and no tool row class. In the restore window, base full spent 50 ms inclusive in `ToolExecutionComponent` and 23.7 ms self in `Text`. Neither appears in the generic run's top six, and busy time fell from 377 to 345 ms.

### Look

Captures are in `bench/results/visual/generic-*.png` (100x40, `pty-capture.py` on a 10-turn mixed session): `generic-collapsed`, `generic-expanded` (Ctrl+O, then three PageUps to a `tmux_run` panel), and `generic-stock-collapsed` for comparison. In the collapsed capture every row starts its marker at column 2 and its verb at column 5, and every meta ends at column 99, one gutter from the right edge. Generic verbs are longer than the 5-column verb column, so their targets start at column 15 instead of 12. Truncating the tool name to fit would hide which tool ran, so the verb overflows instead. Expanded generic panels use the same indent, background, and blank-line trimming as built-in panels.

### Not measured

- The unregistered path (`next()` returns `undefined`), where stock prints the full JSON and the full output for every row. Snoop takes the same compact path there, so the saving is likely larger. That is a guess, since no fixture restores unregistered tools.
- Live streaming of a renderer-less tool. A running generic row shows its marker and target with no preview or meta until the result is final.

## Startup: prebuilt JavaScript entry experiment

Verdict: reverted. The prebuilt entry made startup substantially slower in this checkout. The existing TypeScript entries remain in the package.

The startup harness alternates stock and full, starts each run with a new agent directory, checks output and exit status, and takes Pi's timings on a second launch. Both launches share `TMPDIR`, so jiti's `TMPDIR/jiti` cache is warm after the first round, despite fresh agent directories. Node also uses `TMPDIR/node-compile-cache`. The cold first round remains in the table. Pi 1.5.2 documents `.js` extension discovery in `docs/extensions.md`.

The prototype bundled one entry with `bun build src/index.ts --target=node --format=esm --external '@earendil-works/*'` and changed `pi.extensions` to the bundle. Each table value is the median and min..max of nine interleaved rounds. The paired columns are full minus stock in each round. All startup runs exited successfully and reported complete timing groups. Raw records are [before](js-entry-before.jsonl) and [prototype](js-entry-prototype.jsonl).

| Metric | Before stock | Before full | Before paired | Prototype stock | Prototype full | Prototype paired |
|---|---:|---:|---:|---:|---:|---:|
| Process CPU ms | 258 (252..453) | 262 (256..447) | 4.5 (-6.7..19.4) | 255 (253..266) | 539 (526..814) | 283 (272..548) |
| Extension load ms | 10 (9..10) | 14 (14..16) | 5 (4..6) | 10 (9..10) | 226 (223..235) | 217 (213..225) |
| First settled frame ms | 291 (289..436) | 298 (293..398) | 5.1 (-38.0..14.1) | 292 (290..295) | 511 (507..822) | 219 (215..526) |
| Pi startup benchmark process CPU ms | 244 (240..251) | 252 (246..254) | 8.4 (1.5..10.7) | 244 (242..253) | 523 (512..556) | 276 (259..310) |

Before the prototype, Pi's timed session runtime was 7 ms higher paired (6..9), while interactive initialization was 2 ms lower (-2..0) and theme initialization was 1 ms lower (-1..1). The three snoop imports totaled 3 ms in one timed full run. A warm CPU profile per side sampled 172 ms busy for stock and 178 ms for full, with zero samples in snoop source in both. The largest stock and full self-time buckets included Pi bundle code and `spawnSync`, not snoop rendering. Sampling is too coarse to assign the remaining few milliseconds to a specific function.

A separate prototype profile showed Node module compilation and file loading. Its frames include both Pi's installed bundle and the checkout's separate `node_modules` copy of `@earendil-works/pi-coding-agent`. Native JavaScript imports resolve that separate copy instead of reusing the bundled Pi modules. This is the observed cause of the large prototype load, not an estimate of TypeScript transpilation cost. The profile also explains why a prebuilt entry is not a win in this installation.

After reverting the prototype, the five-round [long run](js-entry-long.jsonl) produced output for all steps and no echo misses. All five full runs failed the existing width checks: the widest rules measured 88 and 118 columns rather than 90 and 120, and the storm ended at 88 rather than 90. The checks are therefore not evidence of a clean long-workload pass. The restored code was unchanged from baseline.

The machine has 10 cores. `uptime` load averages were 4.83, 4.18, 4.66 before baseline; 4.48, 4.16, 4.63 after baseline; 9.69, 5.83, 5.22 after the prototype; and 4.08, 4.98, 4.96 after the long run. Other work shared the machine. Interleaving limits drift but does not eliminate noise.
