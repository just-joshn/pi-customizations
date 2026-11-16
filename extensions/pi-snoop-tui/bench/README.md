# pi-snoop-tui benchmarks

This directory holds a rerunnable performance benchmark and the visual capture scripts. None of it ships: the package `files` list includes only `src`, `themes`, `README.md`, and `CHANGELOG.md`.

## Run the replay benchmark

You need Pi 1.5.2 on `PATH` as `pi`, Python 3, and `rg` on `PATH` for Pi's `grep` tool.

```sh
cd extensions/pi-snoop-tui/bench
python3 run.py --runs 7 --out results.jsonl
python3 report.py results.jsonl
```

`run.py` appends one JSON object per run to `--out`. Records from `--workload long` carry `"workloadName": "long"`. `report.py` prints a Markdown table of the median and min..max per configuration, then a table of per-round differences from `stock`. Use `--configs stock,full` to run a subset and `--keep-artifacts` to keep each run's workspace, raw `pty.log`, and chunk timings.

Each round runs every configuration once. The order rotates each round, so warmup and drift do not favor one configuration.

## What a run does

`run.py` starts Pi in a 120x40 pseudo-terminal with `TERM=xterm-256color` and `COLORTERM=truecolor`. Each run gets a fresh temporary workspace and a fresh `PI_CODING_AGENT_DIR` whose `settings.json` sets `quietStartup`, `collapseChangelog`, and no packages. Every configuration shares these flags: `--no-extensions -e bench-provider.ts --provider bench --model replay --no-session --offline --no-mcp --no-skills --no-prompt-templates --no-context-files --tools read,bash,edit,grep`.

| Config | Extra flags |
|---|---|
| `stock` | `--use-theme dark` |
| `theme` | `--theme <package>/themes --use-theme snoop-dark` |
| `full` | `-e <package> --use-theme snoop-dark` |
| `spinner` | `full` without `chrome.ts`, so Pi keeps its animated spinner. Not in the default set. |

`bench-provider.ts` registers the `bench/replay` model through Pi's custom streaming API. On `session_start` it writes `fixture.txt` (2000 lines) and `edit-target.txt` into the workspace. The script picks a turn by the number of assistant messages in context:

1. Turn 1 streams 3000 characters of Markdown, 30 characters every 8 ms. It then calls `bash` (prints 3000 lines over about 2 s), `read` on `fixture.txt`, `grep` for `marker` in `fixture.txt`, and `edit` on `edit-target.txt`.
2. Turn 2 streams 1500 characters and stops.

The script picks the turn by the number of assistant messages after the latest user message, so a restored session starts at turn 1.

The driver waits for the first frame to settle, types the prompt, and presses Enter. While Pi streams, it sends `q` every 250 ms, 10 times. Ten seconds after `agent_end`, the provider disables the event-loop sampler and waits another 10 s (the clean idle phase). It then appends its record to `SNOOP_BENCH_OUT` and calls `ctx.shutdown()`. The driver merges its terminal metrics into the record. A run whose tool count is not 4, whose edit did not land, or that saw no output or missed an echo gets a `problems` field and keeps its artifacts.

## What each number measures

All in-process numbers come from the Pi process itself. The workload phase runs from `agent_start` to `agent_end`. The idle phase is the 10 s after `agent_end`.

- **Workload CPU ms.** `process.cpuUsage()` user plus system time across the workload phase. Child processes such as the `bash` tool's shell are not included.
- **Idle CPU ms.** The same counter over the idle phase. The event-loop sampler below wakes Pi every 10 ms in every configuration, so this number never reaches zero. Compare it between configurations, not against zero.
- **Event-loop delay p50 and p99.** `perf_hooks.monitorEventLoopDelay({ resolution: 10 })`. Each sample is the time between two 10 ms timer ticks, so an unblocked loop reads about 10 to 11 ms. The excess over 10 ms is the time the loop was busy. The histogram resets at `agent_end`.
- **Clean idle CPU ms.** `process.cpuUsage()` over the 10 s after the idle phase, with the event-loop sampler disabled. Nothing in the bench wakes Pi here, so any CPU is periodic work by Pi or an extension. The record also carries the voluntary and involuntary context switches from `process.resourceUsage()` and the PTY bytes for the same window.
- **Echo latency p50 and p95.** The time from writing `q` to the first output whose ANSI-stripped text contains the whole run of `q`s typed so far. Pi must handle the key and redraw the editor line. The run of `q`s rules out the kernel's own echo and stray `q`s in the output, and the workload text contains no `q`.
- **Echo misses.** Keystrokes with no echo within 1 s.
- **PTY bytes.** Bytes Pi wrote to the terminal, bucketed by read time into the workload phase, the idle phase, and the idle phase after its first second. The first second holds the one redraw that clears the working indicator. Any bytes after it point to periodic output.
- **Tool results and errors.** `tool_execution_end` events and their `isError` flags.
- **Workload wall ms.** Wall time of the workload phase. The script's sleeps set most of it, so it mostly shows that the run did the scripted work.

The benchmark does not measure the terminal emulator's paint time or how a real terminal handles the bytes. Echo latency stops at the pseudo-terminal, not at pixels on screen.

## Run the long-session benchmark

```sh
python3 run.py --workload long --runs 5 --out results-long.jsonl
python3 report.py results-long.jsonl
```

`--workload long` measures a restored session instead of a streamed turn. Each run writes `visual/mockup-fixture.py`'s conversation repeated 150 times (1050 tool calls) into a fresh workspace and starts Pi on it with `--session <file>`. It drops the bench provider and `--no-session` but keeps the other shared flags, the configs, the 120x40 pseudo-terminal, and the fresh `PI_CODING_AGENT_DIR`. The driver then runs five steps and times each one until the output settles:

1. `startup`: from spawn.
2. `narrow`: resize to 90x40 with `TIOCSWINSZ` on the master, which sends Pi `SIGWINCH`.
3. `wide`: resize back to 120x40.
4. `expand`: Ctrl+O, which expands every tool row. After it settles, type ten `q` characters at 250 ms intervals and measure echo latency and misses as in the stream workload. Clear the editor with Ctrl+U.
5. `collapse`: Ctrl+O again.

A step settles when Pi writes nothing for 500 ms. Its time runs to the last byte before that quiet period. A step with no output within 5 s (60 s for startup) has no output and becomes a problem. A step still writing after 60 s is a timeout and fails the run. Each step records its bytes and the widest horizontal rule it drew, and a resize whose rule does not match the new width is a problem. A rule two columns narrower also passes, because snoop's editor rules are inset by one gutter column on each side. The driver then sends Ctrl+D and reads the child's user and system CPU for the whole run from `os.wait4`, and the bytes Pi wrote on exit.

Before the first resize, the driver also types 20 `q` characters at 100 ms intervals with every row collapsed, and records their echo latency and misses as `collapsedEcho`. After Ctrl+U it writes 50 `q` characters back to back and records the time until the whole run of 50 appears as `burst`. After `collapse`, the `storm` step resizes five times back to back (90, 120, 90, 120, 90 columns) and settles. Its last horizontal rule must be 90 columns wide, or 88 for an inset rule. The driver then restores 120 columns before exit, so exit bytes stay comparable. The whole-run CPU includes these steps.

`report.py` prints one section per workload and drops a metric when a record lacks it, so older result files still report.

`summary.py label=results.jsonl ...` prints the headline metrics of each file in one table: the `stock` and `full` medians, the paired difference, the rounds `full` was lower, and two verdicts. The strict verdict needs the paired min..max to exclude 0. The sign-test verdict needs `full` lower or higher in 13 of 15, 7 of 9, or 6 of 7 rounds. `--config` and `--baseline` pick other configurations. `results/final.md` uses it.

## Run the mixed-tool benchmark

```sh
python3 run.py --workload mixed --runs 5 --configs stock,full --out results-mixed.jsonl
```

`--workload mixed` runs the long-session steps on a session from `mixed-fixture.py`: 50 turns of six tool calls each (300 tool rows). Half the rows call `codemode`, `pi_spawn`, and `tmux_run`, which `bench-provider.ts` registers with no `renderCall` or `renderResult`, the way pstack registers them. Their results hold 20 to 200 lines of text, and 5 `codemode` and 3 `tmux_run` results fail. The rest are `read`, `edit`, and `bash`. The run loads `bench-provider.ts` and adds the three tools to `--tools`, so stock draws them with Pi's fallback: the tool name and arguments, then the first 10 lines of output in a padded `Box`. Records carry `"workloadName": "mixed"`.

## Run the startup and medium-session benchmarks

```sh
python3 run.py --workload startup --runs 5 --out results-startup.jsonl
python3 run.py --workload medium --runs 5 --out results-medium.jsonl
```

`--workload startup` starts Pi with the stream workload's flags and an empty in-memory session. It times spawn to the first settled frame (500 ms quiet), sends Ctrl+D, and reads the process CPU from `os.wait4`. It then starts Pi again with `PI_STARTUP_BENCHMARK=1 PI_TIMING=1`, which makes Pi initialize the interactive mode, exit, and print its own startup phases and the import and factory time of each extension. The record keeps those as `timingsMs`.

`--workload medium` runs the stream workload on a restored session from `medium-fixture.py`: 30 turns of Markdown with headings, lists, tables, and code blocks, and five tool calls each (150 tool rows). The record carries `"workloadName": "medium"`.

Every step and typing record carries a `windowUs` pair on the same monotonic clock as Node's `process.hrtime`, so a profile can be cut to that window.

## Profile a run

`NODE_OPTIONS` reaches Pi's Node process through the `pi` launcher. Profile in a run you do not report, because the profiler slows Pi down:

```sh
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$TMPDIR/prof-full" python3 run.py --runs 1 --configs full --out "$TMPDIR/prof.jsonl"
python3 profile-summary.py "$TMPDIR/prof-full" --record "$TMPDIR/prof.jsonl"
```

`profile-summary.py` prints the top self-time functions and the share that falls in `pi-snoop-tui/src/`. With `--record`, it keeps only the samples between `agent_start` and `agent_end` of the last record in that file. `--phase` picks another window from that record: `idle`, `cleanIdle`, a long step name such as `storm`, `typing` (collapsed), `expandedTyping`, or `burst`, or `startup`.

It also buckets busy time by owner: each sample goes to the innermost class in its stack. Pi ships as a minified bundle, so the script finds class bodies in the bundle source by matching braces. It prints owner self time, inclusive time per class, and self time per file.

## Capture screenshots

The `visual/` scripts render Pi frames to PNG for visual review. They write to `visual/out/`, which git ignores.

- `capture.sh <label> <cols> <rows> [pi args...]` starts Pi in tmux on a replayed session, waits for the frame to settle, and saves `.ansi` and `.txt` captures. Set `FIXTURE` to use your own session file. Set `KEYS` to send keys and capture again.
- `mockup-fixture.py <out.jsonl> <cwd>` writes the default replay session: read, edit, a passing and a failing bash call, grep, an image read, and codemode.
- `pty-capture.py <out-prefix> <cols> <rows> <session.jsonl> [--expand] [--page-up=N] -- [pi args...]` does the same in a pseudo-terminal through `pyte`, for sandboxes where tmux cannot open its socket. Run it with `uv run --with pyte`.
- `ansi2png.py <in.ansi> <out.png>` renders a capture with Pillow. Run it with `uv run --with pillow`.

## Record the README demo

```sh
cd extensions/pi-snoop-tui/bench/visual
uv run --with pyte python3 record-demo.py && uv run --with pillow python3 make-gif.py
```

`record-demo.py` starts Pi in a 100x32 pseudo-terminal with the package and `demo-provider.ts`, in a fresh git workspace on `main` and a fresh `PI_CODING_AGENT_DIR` with the recommended settings. The provider registers the scripted `demo/demo-model` model and writes a small TypeScript project on `session_start`. Its `npm test` script fails until the second edit adds `signal?.throwIfAborted()`. The recorder types the prompt, waits for the agent to finish, then expands and collapses tool rows with Ctrl+O. It saves every distinct screen with its timestamp to `out/demo-frames.json.gz`, and fails if a scripted state never appeared.

`make-gif.py` renders those frames with Menlo, which draws every glyph the rows use, and writes `docs/demo.gif`. It caps idle stretches at 2.5 s and holds the last frame for 2.5 s. Add `--png-dir=<dir>` to also write each frame as a PNG for review. `docs/` is not in the package `files` list, so the README links the GIF by absolute URL.
