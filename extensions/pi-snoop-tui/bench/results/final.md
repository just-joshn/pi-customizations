# Final stock comparison

> This file is the later recorded run after [`2026-11-15.md`](2026-11-15.md), not a description of the current package. It records the scripts under their names on the run date. `summary.py` and `report.py` are now `summary.ts` and `report.ts`, run with `node`. `run.py` is unchanged. Commit ids below come from the benchmark worktree and are not part of this repository's history.

## Setup

- Machine: Apple M4, 10 cores
- Pi: 1.5.2
- Commit: bcaf77cdf381bb9c168bdb60f9521f22f4f3b756 from the benchmark worktree. It was HEAD when the runs started. The working tree differed only in `bench/README.md` and an untracked `bench/summary.py`, and Pi loads neither.
- Configs: stock, theme, full, interleaved with a rotating order per round
- Rounds: startup 15, stream 7, medium 9, long 9, mixed 7, each round running every config once
- Raw records: `final-<workload>.jsonl` beside this file
- Problem records: none. Every record in all five files has no `error`, no `problems`, exit code 0, 4 tool results and 0 tool errors (stream and medium), 0 echo misses, and an echoed burst (long and mixed).
- Summary tables: `node summary.ts startup=results/final-startup.jsonl ...` from `bench/`. The runs used the earlier `summary.py`.

## Uptime log

The wait gate was a 1-minute load below 6, polled every 30 s. No workload waited, and the 1-minute load stayed between 2.4 and 4.1 at every check. No set showed every config jumping together, so none was rerun.

```
startup: waited 0s
startup before: 17:34  up 3 days, 11:56, 3 users, load averages: 3.36 3.64 3.64
startup exit=0 after: 17:35  up 3 days, 11:56, 3 users, load averages: 4.10 3.80 3.70
stream: waited 0s
stream before: 17:35  up 3 days, 11:56, 3 users, load averages: 4.10 3.80 3.70
stream exit=0 after: 17:44  up 3 days, 12:05, 3 users, load averages: 3.37 3.59 3.63
medium: waited 0s
medium before: 17:44  up 3 days, 12:05, 3 users, load averages: 3.74 3.67 3.66
medium exit=0 after: 17:55  up 3 days, 12:17, 3 users, load averages: 3.84 3.67 3.62
long: waited 0s
long before: 17:55  up 3 days, 12:17, 3 users, load averages: 3.84 3.67 3.62
long exit=0 after: 18:00  up 3 days, 12:21, 3 users, load averages: 2.38 3.08 3.38
mixed: waited 0s
mixed before: 18:00  up 3 days, 12:21, 3 users, load averages: 2.38 3.08 3.38
mixed exit=0 after: 18:04  up 3 days, 12:25, 3 users, load averages: 3.61 3.08 3.29
ALLDONE
```

## Verdict rules

(a) Strict: faster or slower only if the paired full-minus-stock min..max excludes 0, otherwise no measurable difference. (b) Sign test: faster if full is lower in at least 13 of 15, 7 of 9, or 6 of 7 rounds (one-sided p < 0.07), slower if full is higher in at least that many, otherwise no measurable difference. Percent change is full median over stock median minus 1. Times are ms. "Restore" is the long and mixed startup settle, and resize rows are the 120 to 90 (narrow), 90 to 120 (wide), and five-resize (storm) settle times.

## Startup note

Full's spawn-to-exit CPU is 8.7 ms above stock in this run, against 4.1 ms in the quiet rerun at 4993ca2f. Pi's own phases match that rerun: `main TOTAL` +4 ms (was +5), `extensions TOTAL` +3 ms (was +3), and `PI_STARTUP_BENCHMARK` CPU +5.5 ms (was +6.8). A direct check right after this run (`panel-box-startup.jsonl`, 15 rounds of `stock,base,full`, where `base` is the package at 15de98e5) put full at +4.5 ms over stock and 0.1 ms over base (lower in 7 of 15). So the extra 4 ms here is run-to-run variation, not the panel change, which runs only when a tool row expands.

## Summary

### Startup

| Scenario | Metric | stock median | full median | full-stock paired median (min..max) | rounds full lower | change of medians | verdict (a) strict | verdict (b) sign test |
|---|---|---|---|---|---|---|---|---|
| startup | Process CPU ms, spawn to exit | 254 | 265 | 8.73 (0.87..18.5) | 0/15 | +4.3% | slower | slower |
| startup | First settled frame ms | 293 | 300 | 6.66 (-23.6..10.0) | 1/15 | +2.5% | no measurable difference | slower |

### Stream

| Scenario | Metric | stock median | full median | full-stock paired median (min..max) | rounds full lower | change of medians | verdict (a) strict | verdict (b) sign test |
|---|---|---|---|---|---|---|---|---|
| stream | Workload CPU ms | 258 | 195 | -77.0 (-86.3..-49.4) | 7/7 | -24.5% | faster | faster |
| stream | Echo p50 ms | 0.53 | 0.54 | -0.02 (-0.04..0.18) | 4/7 | +2.8% | no measurable difference | no measurable difference |
| stream | Workload PTY bytes | 296620 | 295851 | -4616 (-29409..6365) | 4/7 | -0.3% | no measurable difference | no measurable difference |
| stream | Clean idle CPU ms | 0.27 | 0.28 | -0.02 (-0.28..0.63) | 4/7 | +5.2% | no measurable difference | no measurable difference |

### Medium

| Scenario | Metric | stock median | full median | full-stock paired median (min..max) | rounds full lower | change of medians | verdict (a) strict | verdict (b) sign test |
|---|---|---|---|---|---|---|---|---|
| medium | Workload CPU ms | 349 | 222 | -127 (-154..-119) | 9/9 | -36.3% | faster | faster |
| medium | Echo p50 ms | 0.89 | 0.64 | -0.28 (-0.48..-0.10) | 9/9 | -27.8% | faster | faster |
| medium | Workload PTY bytes | 345378 | 341375 | -3688 (-22171..6887) | 6/9 | -1.2% | no measurable difference | no measurable difference |
| medium | Clean idle CPU ms | 0.30 | 0.23 | -0.06 (-0.34..0.04) | 6/9 | -21.6% | no measurable difference | no measurable difference |

### Long

| Scenario | Metric | stock median | full median | full-stock paired median (min..max) | rounds full lower | change of medians | verdict (a) strict | verdict (b) sign test |
|---|---|---|---|---|---|---|---|---|
| long | Whole-run CPU ms | 1232 | 892 | -357 (-437..-321) | 9/9 | -27.6% | faster | faster |
| long | Restore (startup settle) ms | 428 | 354 | -75.5 (-79.4..-48.5) | 9/9 | -17.2% | faster | faster |
| long | Collapsed echo p50 ms | 1.90 | 1.42 | -0.51 (-0.88..0.03) | 8/9 | -25.3% | no measurable difference | faster |
| long | Collapsed echo p95 ms | 2.56 | 2.26 | -0.51 (-3.53..0.18) | 8/9 | -11.8% | no measurable difference | faster |
| long | Burst of 50 keys ms | 3.89 | 3.31 | -0.71 (-1.24..-0.14) | 9/9 | -15.0% | faster | faster |
| long | Resize narrow ms | 40.2 | 10.0 | -30.3 (-31.9..-27.5) | 9/9 | -75.0% | faster | faster |
| long | Resize wide ms | 40.0 | 8.57 | -31.1 (-32.3..-29.4) | 9/9 | -78.6% | faster | faster |
| long | Resize storm ms | 36.7 | 9.90 | -27.0 (-28.2..-26.0) | 9/9 | -73.0% | faster | faster |
| long | Expand ms | 130 | 125 | -4.56 (-31.4..-0.70) | 9/9 | -3.9% | faster | faster |
| long | Expanded echo p50 ms | 2.28 | 1.87 | -0.48 (-0.84..0.25) | 8/9 | -17.8% | no measurable difference | faster |
| long | Collapse ms | 33.3 | 5.10 | -27.7 (-31.7..-26.6) | 9/9 | -84.6% | faster | faster |

### Mixed

| Scenario | Metric | stock median | full median | full-stock paired median (min..max) | rounds full lower | change of medians | verdict (a) strict | verdict (b) sign test |
|---|---|---|---|---|---|---|---|---|
| mixed | Whole-run CPU ms | 969 | 667 | -303 (-327..-298) | 7/7 | -31.2% | faster | faster |
| mixed | Restore (startup settle) ms | 369 | 329 | -41.5 (-46.1..-28.1) | 7/7 | -10.8% | faster | faster |
| mixed | Collapsed echo p50 ms | 1.10 | 0.83 | -0.26 (-0.40..-0.18) | 7/7 | -24.4% | faster | faster |
| mixed | Collapsed echo p95 ms | 1.53 | 1.36 | -0.17 (-0.33..-0.12) | 7/7 | -11.2% | faster | faster |
| mixed | Burst of 50 keys ms | 2.91 | 2.45 | -0.44 (-1.28..-0.25) | 7/7 | -15.6% | faster | faster |
| mixed | Resize narrow ms | 24.4 | 5.74 | -18.5 (-19.4..-16.8) | 7/7 | -76.5% | faster | faster |
| mixed | Resize wide ms | 22.9 | 4.68 | -18.0 (-19.3..-17.9) | 7/7 | -79.6% | faster | faster |
| mixed | Resize storm ms | 22.9 | 5.08 | -17.9 (-18.9..-17.1) | 7/7 | -77.9% | faster | faster |
| mixed | Expand ms | 180 | 151 | -29.8 (-33.5..-27.3) | 7/7 | -16.4% | faster | faster |
| mixed | Expanded echo p50 ms | 1.37 | 1.07 | -0.29 (-0.33..-0.13) | 7/7 | -21.6% | faster | faster |
| mixed | Collapse ms | 22.7 | 2.27 | -20.5 (-21.6..-19.9) | 7/7 | -90.0% | faster | faster |

## Reading the summary

Full uses less CPU than stock in every stream, medium, long, and mixed round, and restore, resizes, collapse, Ctrl+O expand, and bursts are faster in every long and mixed round. Long Ctrl+O expand is now 4.6 ms faster than stock (lower in 9 of 9) and long expanded echo p50 is 0.48 ms lower (8 of 9), where the run at 4993ca2f had them 5.5 ms and 0.30 ms slower. Medium echo p50 is 0.28 ms lower in all 9 rounds. Startup is the one cost: full's process CPU is higher in every round (+8.7 ms, +4.3%, see the startup note) and its first frame is lower in only 1 of 15 (+6.7 ms, +2.5%). Stream echo, stream and medium PTY bytes, and clean idle CPU show no measurable difference.

## Full report.py output

### Report: startup

#### startup workload

Median (min..max) per config.

| Metric | stock (n=15, failed=0, problems=0) | theme (n=15, failed=0, problems=0) | full (n=15, failed=0, problems=0) |
|---|---|---|---|
| First settled frame ms | 293 (291..427) | 295 (293..305) | 300 (295..404) |
| First frame PTY bytes | 2422 (2422..2422) | 2416 (2416..2416) | 3764 (3764..3764) |
| Process CPU ms (user+sys), spawn to exit | 254 (251..449) | 258 (256..282) | 265 (259..450) |
| Exit PTY bytes | 1520 (1520..1520) | 1514 (1514..1514) | 1533 (1533..1533) |
| PI_TIMING main TOTAL ms | 161 (158..162) | 162 (160..164) | 165 (163..174) |
| PI_TIMING createAgentSessionRuntime ms | 29 (29..31) | 32 (32..35) | 35 (34..42) |
| PI_TIMING initTheme ms | 9 (8..9) | 8 (8..9) | 8 (8..9) |
| PI_TIMING interactiveMode.init ms | 118 (117..119) | 116 (115..118) | 117 (116..118) |
| PI_TIMING extensions TOTAL ms | 10 (9..11) | 10 (9..12) | 13 (12..15) |
| PI_STARTUP_BENCHMARK process CPU ms | 246 (241..252) | 248 (244..261) | 251 (244..282) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| First settled frame ms | 1 (-133..13), lower 5/15 | 6.7 (-23.6..10.0), lower 1/15 |
| First frame PTY bytes | -6 (-6..-6), lower 15/15 | 1342 (1342..1342), lower 0/15 |
| Process CPU ms (user+sys), spawn to exit | 3 (-193..27), lower 4/15 | 8.7 (0.9..18.5), lower 0/15 |
| Exit PTY bytes | -6 (-6..-6), lower 15/15 | 13 (13..13), lower 0/15 |
| PI_TIMING main TOTAL ms | 1 (-1..6), lower 1/15 | 4 (2..12), lower 0/15 |
| PI_TIMING createAgentSessionRuntime ms | 3 (1..6), lower 0/15 | 6 (4..11), lower 0/15 |
| PI_TIMING initTheme ms | 0 (-1..1), lower 7/15 | 0 (-1..1), lower 7/15 |
| PI_TIMING interactiveMode.init ms | -2 (-3..0), lower 13/15 | 0 (-2..1), lower 7/15 |
| PI_TIMING extensions TOTAL ms | 0 (-1..3), lower 6/15 | 3 (2..5), lower 0/15 |
| PI_STARTUP_BENCHMARK process CPU ms | 3.7 (-3.3..13.5), lower 3/15 | 5.5 (1.3..33.6), lower 0/15 |

### Report: stream

#### stream workload

Median (min..max) per config.

| Metric | stock (n=7, failed=0, problems=0) | theme (n=7, failed=0, problems=0) | full (n=7, failed=0, problems=0) |
|---|---|---|---|
| Workload CPU ms (user+sys) | 258 (246..277) | 256 (251..260) | 195 (171..205) |
| Idle CPU ms over 10 s | 4.95 (4.82..5.33) | 5.00 (4.75..5.82) | 4.98 (4.84..5.44) |
| Workload event-loop delay p50 ms | 11.4 (11.3..11.4) | 11.3 (11.3..11.4) | 11.6 (11.4..11.8) |
| Workload event-loop delay p99 ms | 12.8 (12.6..13.0) | 12.6 (12.5..12.9) | 12.7 (12.4..12.8) |
| Idle event-loop delay p50 ms | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) |
| Idle event-loop delay p99 ms | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) |
| Echo latency p50 ms | 0.53 (0.42..0.59) | 0.52 (0.40..0.67) | 0.54 (0.49..0.61) |
| Echo latency p95 ms | 0.85 (0.76..1.06) | 0.85 (0.73..1.01) | 0.89 (0.84..1.36) |
| Echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| PTY bytes, workload | 296620 (293538..313811) | 301049 (295922..306141) | 295851 (278968..302431) |
| PTY bytes, idle 10 s | 6014 (791..6014) | 788 (788..5999) | 841 (841..6214) |
| PTY bytes, idle after first 1 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Clean idle CPU ms over 10 s, no sampler | 0.27 (0.23..0.61) | 0.30 (0.22..0.72) | 0.28 (0.22..0.91) |
| Clean idle involuntary context switches | 4 (4..6) | 5 (4..7) | 4 (4..6) |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Tool results | 4 (4..4) | 4 (4..4) | 4 (4..4) |
| Tool errors | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Workload wall ms | 3563 (3559..3589) | 3565 (3554..3577) | 3563 (3553..3594) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| Workload CPU ms (user+sys) | -3.0 (-20.9..11.9), lower 4/7 | -77.0 (-86.3..-49.4), lower 7/7 |
| Idle CPU ms over 10 s | 0.02 (-0.25..0.89), lower 3/7 | 0.11 (-0.32..0.22), lower 2/7 |
| Workload event-loop delay p50 ms | -0.02 (-0.07..0.05), lower 4/7 | 0.25 (0.06..0.49), lower 0/7 |
| Workload event-loop delay p99 ms | -0.01 (-0.36..0.26), lower 4/7 | -0.12 (-0.53..0.17), lower 5/7 |
| Idle event-loop delay p50 ms | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| Idle event-loop delay p99 ms | 0 (0..0), lower 0/7 | 0.00 (-0.01..0.01), lower 1/7 |
| Echo latency p50 ms | -0.02 (-0.11..0.16), lower 4/7 | -0.02 (-0.04..0.18), lower 4/7 |
| Echo latency p95 ms | -0.03 (-0.21..0.15), lower 4/7 | 0.04 (-0.16..0.49), lower 3/7 |
| Echo misses | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| PTY bytes, workload | 114 (-8577..9413), lower 3/7 | -4616 (-29409..6365), lower 4/7 |
| PTY bytes, idle 10 s | -5226 (-5226..5208), lower 6/7 | -5173 (-5173..5423), lower 4/7 |
| PTY bytes, idle after first 1 s | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| Clean idle CPU ms over 10 s, no sampler | 0.01 (-0.32..0.48), lower 3/7 | -0.02 (-0.28..0.63), lower 4/7 |
| Clean idle involuntary context switches | 1 (-2..3), lower 1/7 | 0 (-2..2), lower 1/7 |
| PTY bytes, clean idle 10 s | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| Tool results | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| Tool errors | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| Workload wall ms | 6.1 (-27.7..18.0), lower 3/7 | -1.1 (-19.6..26.3), lower 5/7 |

### Report: medium

#### medium workload

Median (min..max) per config.

| Metric | stock (n=9, failed=0, problems=0) | theme (n=9, failed=0, problems=0) | full (n=9, failed=0, problems=0) |
|---|---|---|---|
| Workload CPU ms (user+sys) | 349 (345..358) | 347 (339..354) | 222 (194..234) |
| Idle CPU ms over 10 s | 5.97 (5.59..6.65) | 5.79 (5.36..6.59) | 6.63 (5.53..9.99) |
| Workload event-loop delay p50 ms | 11.3 (11.3..11.4) | 11.3 (11.3..11.4) | 11.7 (11.5..11.8) |
| Workload event-loop delay p99 ms | 12.7 (12.6..13.1) | 12.7 (12.6..12.8) | 12.6 (12.5..12.7) |
| Idle event-loop delay p50 ms | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) |
| Idle event-loop delay p99 ms | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) | 12.0 (12.0..12.0) |
| Echo latency p50 ms | 0.89 (0.74..1.21) | 0.73 (0.68..1.38) | 0.64 (0.56..0.73) |
| Echo latency p95 ms | 1.23 (1.03..2.91) | 1.17 (0.98..1.58) | 0.92 (0.83..1.25) |
| Echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| PTY bytes, workload | 345378 (340779..357517) | 349163 (338735..354885) | 341375 (335036..352265) |
| PTY bytes, idle 10 s | 6016 (793..6016) | 790 (790..6001) | 841 (841..6214) |
| PTY bytes, idle after first 1 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Clean idle CPU ms over 10 s, no sampler | 0.30 (0.20..0.59) | 0.29 (0.22..0.60) | 0.23 (0.21..0.36) |
| Clean idle involuntary context switches | 5 (4..6) | 4 (4..6) | 4 (4..4) |
| PTY bytes, clean idle 10 s | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Tool results | 4 (4..4) | 4 (4..4) | 4 (4..4) |
| Tool errors | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Workload wall ms | 3572 (3553..3601) | 3568 (3522..3601) | 3575 (3556..3608) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| Workload CPU ms (user+sys) | -4.7 (-11.2..2.2), lower 8/9 | -127 (-154..-119), lower 9/9 |
| Idle CPU ms over 10 s | -0.18 (-0.89..0.96), lower 6/9 | 1.05 (-1.10..4.37), lower 3/9 |
| Workload event-loop delay p50 ms | 0.01 (-0.06..0.02), lower 2/9 | 0.35 (0.11..0.52), lower 0/9 |
| Workload event-loop delay p99 ms | -0.02 (-0.52..0.16), lower 5/9 | -0.11 (-0.48..0.04), lower 7/9 |
| Idle event-loop delay p50 ms | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| Idle event-loop delay p99 ms | 0.00 (-0.01..0.01), lower 3/9 | 0.00 (-0.01..0.01), lower 3/9 |
| Echo latency p50 ms | -0.13 (-0.48..0.56), lower 8/9 | -0.28 (-0.48..-0.10), lower 9/9 |
| Echo latency p95 ms | -0.19 (-1.33..0.21), lower 7/9 | -0.35 (-2.04..-0.05), lower 9/9 |
| Echo misses | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| PTY bytes, workload | 4305 (-9102..8896), lower 3/9 | -3688 (-22171..6887), lower 6/9 |
| PTY bytes, idle 10 s | -15 (-5226..5208), lower 7/9 | 48 (-5175..5421), lower 4/9 |
| PTY bytes, idle after first 1 s | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| Clean idle CPU ms over 10 s, no sampler | -0.02 (-0.36..0.40), lower 5/9 | -0.06 (-0.34..0.04), lower 6/9 |
| Clean idle involuntary context switches | -1 (-2..2), lower 5/9 | -1 (-2..0), lower 5/9 |
| PTY bytes, clean idle 10 s | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| Tool results | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| Tool errors | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| Workload wall ms | -3.7 (-31.9..27.2), lower 5/9 | 1.5 (-26.6..44.5), lower 4/9 |

### Report: long

#### long workload

Median (min..max) per config.

| Metric | stock (n=9, failed=0, problems=0) | theme (n=9, failed=0, problems=0) | full (n=9, failed=0, problems=0) |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | 1232 (1205..1329) | 1274 (1218..1324) | 892 (855..940) |
| Collapsed echo latency p50 ms | 1.90 (1.80..2.43) | 2.11 (1.88..2.45) | 1.42 (1.29..2.05) |
| Collapsed echo latency p95 ms | 2.56 (2.45..5.64) | 2.86 (2.30..4.66) | 2.26 (1.78..2.74) |
| Collapsed echo latency max ms | 4.48 (4.40..8.04) | 4.91 (4.38..7.49) | 3.59 (3.41..3.72) |
| Collapsed echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Burst of 50 keys, ms to full echo | 3.89 (3.73..4.41) | 3.85 (3.71..4.97) | 3.31 (3.14..3.59) |
| Burst PTY bytes | 359 (359..360) | 359 (359..360) | 412 (412..412) |
| Burst echoed | 1 (1..1) | 1 (1..1) | 1 (1..1) |
| Expanded echo latency p50 ms | 2.28 (2.22..2.85) | 2.31 (2.24..2.46) | 1.87 (1.75..2.50) |
| Expanded echo latency p95 ms | 2.8 (2.6..19.7) | 2.83 (2.50..6.74) | 2.24 (1.95..2.93) |
| Expanded echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| startup settle ms | 428 (419..449) | 433 (417..460) | 354 (345..374) |
| narrow settle ms | 40.2 (37.6..42.0) | 40.4 (37.8..89.5) | 10.0 (9.1..10.5) |
| wide settle ms | 40.0 (37.9..40.9) | 39.5 (38.0..42.4) | 8.57 (8.30..9.23) |
| expand settle ms | 130 (127..155) | 131 (124..140) | 125 (123..130) |
| collapse settle ms | 33.3 (31.7..37.2) | 33.4 (32.2..36.9) | 5.10 (4.90..5.97) |
| storm settle ms | 36.7 (35.9..38.3) | 35.7 (34.7..39.5) | 9.9 (9.5..10.2) |
| startup PTY bytes | 12601 (12601..12601) | 12598 (12598..12598) | 11391 (11391..11391) |
| narrow PTY bytes | 5401 (5401..5401) | 5403 (5403..5403) | 4635 (4635..4635) |
| wide PTY bytes | 6763 (6763..6763) | 6760 (6760..6760) | 5319 (5319..5319) |
| expand PTY bytes | 4826 (4826..4826) | 4829 (4829..4829) | 5500 (5500..5500) |
| collapse PTY bytes | 451 (451..451) | 451 (451..451) | 3107 (3107..3107) |
| storm PTY bytes | 5245 (5245..5245) | 5247 (5247..5247) | 4659 (4659..4659) |
| Exit PTY bytes | 1524442 (1524442..1524442) | 1524439 (1524439..1524439) | 477450 (477450..477450) |
| Steps with output | 6 (6..6) | 6 (6..6) | 6 (6..6) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| Process CPU ms (user+sys), whole run | 5.5 (-55.3..92.9), lower 2/9 | -357 (-437..-321), lower 9/9 |
| Collapsed echo latency p50 ms | 0.02 (-0.25..0.65), lower 3/9 | -0.51 (-0.88..0.03), lower 8/9 |
| Collapsed echo latency p95 ms | -0.05 (-2.73..2.09), lower 6/9 | -0.51 (-3.53..0.18), lower 8/9 |
| Collapsed echo latency max ms | 0.03 (-2.83..2.58), lower 4/9 | -1.03 (-4.42..-0.74), lower 9/9 |
| Collapsed echo misses | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| Burst of 50 keys, ms to full echo | -0.05 (-0.63..0.65), lower 5/9 | -0.71 (-1.24..-0.14), lower 9/9 |
| Burst PTY bytes | 0 (-1..1), lower 1/9 | 53 (52..53), lower 0/9 |
| Burst echoed | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| Expanded echo latency p50 ms | 0.01 (-0.55..0.19), lower 4/9 | -0.48 (-0.84..0.25), lower 8/9 |
| Expanded echo latency p95 ms | -0.1 (-13.0..0.5), lower 6/9 | -0.6 (-17.5..0.0), lower 8/9 |
| Expanded echo misses | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |
| startup settle ms | 0.8 (-10.0..37.5), lower 4/9 | -75.5 (-79.4..-48.5), lower 9/9 |
| narrow settle ms | 2.0 (-2.5..48.2), lower 3/9 | -30.3 (-31.9..-27.5), lower 9/9 |
| wide settle ms | -0.46 (-2.25..2.82), lower 6/9 | -31.1 (-32.3..-29.4), lower 9/9 |
| expand settle ms | -0.3 (-25.2..10.1), lower 5/9 | -4.6 (-31.4..-0.7), lower 9/9 |
| collapse settle ms | 0.03 (-1.64..3.61), lower 4/9 | -27.7 (-31.7..-26.6), lower 9/9 |
| storm settle ms | -0.77 (-3.26..3.27), lower 7/9 | -27.0 (-28.2..-26.0), lower 9/9 |
| startup PTY bytes | -3 (-3..-3), lower 9/9 | -1210 (-1210..-1210), lower 9/9 |
| narrow PTY bytes | 2 (2..2), lower 0/9 | -766 (-766..-766), lower 9/9 |
| wide PTY bytes | -3 (-3..-3), lower 9/9 | -1444 (-1444..-1444), lower 9/9 |
| expand PTY bytes | 3 (3..3), lower 0/9 | 674 (674..674), lower 0/9 |
| collapse PTY bytes | 0 (0..0), lower 0/9 | 2656 (2656..2656), lower 0/9 |
| storm PTY bytes | 2 (2..2), lower 0/9 | -586 (-586..-586), lower 9/9 |
| Exit PTY bytes | -3 (-3..-3), lower 9/9 | -1046992 (-1046992..-1046992), lower 9/9 |
| Steps with output | 0 (0..0), lower 0/9 | 0 (0..0), lower 0/9 |

### Report: mixed

#### mixed workload

Median (min..max) per config.

| Metric | stock (n=7, failed=0, problems=0) | theme (n=7, failed=0, problems=0) | full (n=7, failed=0, problems=0) |
|---|---|---|---|
| Process CPU ms (user+sys), whole run | 969 (962..1020) | 965 (957..1030) | 667 (661..693) |
| Collapsed echo latency p50 ms | 1.10 (0.98..1.28) | 1.08 (1.05..1.13) | 0.83 (0.78..0.88) |
| Collapsed echo latency p95 ms | 1.53 (1.48..1.90) | 1.53 (1.44..1.77) | 1.36 (1.25..1.57) |
| Collapsed echo latency max ms | 3.43 (3.28..3.93) | 3.37 (3.32..3.54) | 2.99 (2.85..3.34) |
| Collapsed echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| Burst of 50 keys, ms to full echo | 2.91 (2.75..3.84) | 2.96 (2.77..3.06) | 2.45 (2.31..2.78) |
| Burst PTY bytes | 359 (359..360) | 359 (359..360) | 412 (412..412) |
| Burst echoed | 1 (1..1) | 1 (1..1) | 1 (1..1) |
| Expanded echo latency p50 ms | 1.37 (1.33..1.40) | 1.37 (1.32..1.54) | 1.07 (1.05..1.20) |
| Expanded echo latency p95 ms | 1.68 (1.63..1.87) | 1.79 (1.71..2.18) | 1.28 (1.21..1.62) |
| Expanded echo misses | 0 (0..0) | 0 (0..0) | 0 (0..0) |
| startup settle ms | 369 (366..384) | 372 (367..382) | 329 (328..341) |
| narrow settle ms | 24.4 (22.8..24.8) | 24.4 (23.8..38.9) | 5.74 (5.39..6.04) |
| wide settle ms | 22.9 (22.6..24.0) | 22.7 (21.9..23.4) | 4.68 (4.38..5.18) |
| expand settle ms | 180 (178..182) | 180 (176..187) | 151 (146..152) |
| collapse settle ms | 22.7 (22.2..23.8) | 22.6 (22.3..23.2) | 2.27 (2.15..2.42) |
| storm settle ms | 22.9 (22.0..24.3) | 23.2 (22.8..24.1) | 5.08 (4.93..5.40) |
| startup PTY bytes | 13356 (13356..13356) | 13351 (13351..13351) | 11048 (11048..11048) |
| narrow PTY bytes | 5906 (5906..5906) | 5901 (5901..5901) | 4559 (4559..4559) |
| wide PTY bytes | 7057 (7057..7057) | 7052 (7052..7052) | 5301 (5301..5301) |
| expand PTY bytes | 5505 (5505..5505) | 5506 (5506..5506) | 5753 (5753..5753) |
| collapse PTY bytes | 4061 (4061..4061) | 4061 (4061..4061) | 3612 (3612..3612) |
| storm PTY bytes | 5741 (5741..5741) | 5736 (5736..5736) | 4484 (4484..4484) |
| Exit PTY bytes | 624358 (624358..624358) | 624353 (624353..624353) | 117657 (117657..117657) |
| Steps with output | 6 (6..6) | 6 (6..6) | 6 (6..6) |

Paired by round: config minus stock, median (min..max), and rounds where the config was lower.

| Metric | theme | full |
|---|---|---|
| Process CPU ms (user+sys), whole run | -1.1 (-12.3..46.8), lower 4/7 | -303 (-327..-298), lower 7/7 |
| Collapsed echo latency p50 ms | 0.01 (-0.15..0.11), lower 3/7 | -0.26 (-0.40..-0.18), lower 7/7 |
| Collapsed echo latency p95 ms | -0.03 (-0.14..0.12), lower 5/7 | -0.17 (-0.33..-0.12), lower 7/7 |
| Collapsed echo latency max ms | -0.05 (-0.47..0.09), lower 4/7 | -0.51 (-0.83..-0.33), lower 7/7 |
| Collapsed echo misses | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| Burst of 50 keys, ms to full echo | 0.01 (-0.81..0.25), lower 3/7 | -0.44 (-1.28..-0.25), lower 7/7 |
| Burst PTY bytes | 0 (-1..1), lower 1/7 | 53 (52..53), lower 0/7 |
| Burst echoed | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| Expanded echo latency p50 ms | 0.01 (-0.09..0.17), lower 3/7 | -0.29 (-0.33..-0.13), lower 7/7 |
| Expanded echo latency p95 ms | 0.09 (-0.08..0.53), lower 1/7 | -0.42 (-0.57..-0.03), lower 7/7 |
| Expanded echo misses | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
| startup settle ms | -1.3 (-9.2..11.2), lower 4/7 | -41.5 (-46.1..-28.1), lower 7/7 |
| narrow settle ms | 0.3 (-0.9..14.7), lower 3/7 | -18.5 (-19.4..-16.8), lower 7/7 |
| wide settle ms | -0.06 (-1.28..0.72), lower 5/7 | -18.0 (-19.3..-17.9), lower 7/7 |
| expand settle ms | 0.06 (-4.40..7.80), lower 3/7 | -29.8 (-33.5..-27.3), lower 7/7 |
| collapse settle ms | -0.40 (-0.84..0.97), lower 5/7 | -20.5 (-21.6..-19.9), lower 7/7 |
| storm settle ms | 0.06 (-0.72..2.05), lower 3/7 | -17.9 (-18.9..-17.1), lower 7/7 |
| startup PTY bytes | -5 (-5..-5), lower 7/7 | -2308 (-2308..-2308), lower 7/7 |
| narrow PTY bytes | -5 (-5..-5), lower 7/7 | -1347 (-1347..-1347), lower 7/7 |
| wide PTY bytes | -5 (-5..-5), lower 7/7 | -1756 (-1756..-1756), lower 7/7 |
| expand PTY bytes | 1 (1..1), lower 0/7 | 248 (248..248), lower 0/7 |
| collapse PTY bytes | 0 (0..0), lower 0/7 | -449 (-449..-449), lower 7/7 |
| storm PTY bytes | -5 (-5..-5), lower 7/7 | -1257 (-1257..-1257), lower 7/7 |
| Exit PTY bytes | -5 (-5..-5), lower 7/7 | -506701 (-506701..-506701), lower 7/7 |
| Steps with output | 0 (0..0), lower 0/7 | 0 (0..0), lower 0/7 |
