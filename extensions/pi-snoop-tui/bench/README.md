# pi-snoop-tui benchmarks

This directory holds a rerunnable performance benchmark and the visual capture scripts. None of it ships. The package `files` list includes only `src`, `themes`, `README.md`, and `CHANGELOG.md`.

## Run the replay benchmark

You need Pi 1.5.2 on `PATH` as `pi`, Python 3, and `rg` on `PATH` for Pi's `grep` tool.

```sh
cd extensions/pi-snoop-tui/bench
python3 run.py --runs 7 --out results.jsonl
node report.ts results.jsonl
```

`run.py` appends one JSON object per run to `--out`. Records from `--workload long` carry `"workloadName": "long"`. `report.ts` prints a Markdown table of the median and min..max per configuration. It then prints a table of per-round differences from `stock`. Use `--configs stock,full` to run a subset. Use `--keep-artifacts` to keep each run's workspace, raw `pty.log`, and chunk timings.

Each round runs every configuration once. The order rotates each round, so warmup and drift do not favor one configuration.

## What a run does

`run.py` starts Pi in a 120x40 pseudo-terminal (PTY) with `TERM=xterm-256color` and `COLORTERM=truecolor`. Each run gets a fresh temporary workspace and a fresh `PI_CODING_AGENT_DIR`. Its `settings.json` sets `quietStartup` and `collapseChangelog` to `true`, `lastChangelogVersion` to `1.5.2`, and `packages` to an empty list.

Every configuration shares these flags: `--no-extensions -e bench-provider.ts --provider bench --model replay --no-session --offline --no-mcp --no-skills --no-prompt-templates --no-context-files --tools read,bash,edit,grep`.

| Configuration | Extra flags |
|---|---|
| `stock` | `--use-theme dark` |
| `theme` | `--theme <package>/themes --use-theme snoop-dark` |
| `full` | `-e <package> --use-theme snoop-dark` |
| `spinner` | `-e <package>/src/tool-rows.ts -e <package>/src/footer.ts --theme <package>/themes --use-theme snoop-dark` |

The `spinner` configuration loads tool rows and the footer but not `chrome.ts`, so Pi keeps its animated spinner. It is not in the default set.

`bench-provider.ts` registers the `bench/replay` model through Pi's custom streaming API. On `session_start` it writes `fixture.txt` (2000 lines) and `edit-target.txt` into the workspace. The provider picks a turn by counting the assistant messages after the latest user message. A restored session therefore starts at turn 1.

1. Turn 1 streams 3000 characters of Markdown, 30 characters every 8 ms. It then calls `bash`, `read`, `grep`, and `edit`. The `bash` call prints 3000 lines over about 2 s. The `read` call targets `fixture.txt`. The `grep` call searches `fixture.txt` for `marker`. The `edit` call changes `edit-target.txt`.
2. Turn 2 streams 1500 characters and stops.

The driver waits for the first frame to settle, types the prompt, and presses Enter. While Pi streams, it sends `q` every 250 ms, 10 times. Ten seconds after `agent_end`, the provider disables the event-loop sampler and waits another 10 s. This second wait is the clean idle step. The provider then appends its record to `SNOOP_BENCH_OUT` and calls `ctx.shutdown()`. The driver merges its terminal metrics into the record.

A run gets a `problems` field and keeps its artifacts when any of these hold:

- The tool result count is not 4.
- A tool reported an error.
- The edit did not land.
- The workload step wrote no PTY bytes.
- A keystroke had no echo.
- The clean idle step lasted under 9000 ms.

## What each number measures

All in-process numbers come from the Pi process itself. The workload step runs from `agent_start` to `agent_end`. The idle step is the 10 s after `agent_end`.

- **Workload CPU ms.** `process.cpuUsage()` user plus system time across the workload step. Child processes, such as the `bash` tool's shell, are not included.
- **Idle CPU ms.** The same counter over the idle step. The event-loop sampler wakes Pi every 10 ms in every configuration, so this number never reaches zero. Compare it between configurations, not against zero.
- **Event-loop delay p50 and p99.** `perf_hooks.monitorEventLoopDelay({ resolution: 10 })`. Each sample is the time between two 10 ms timer ticks, so an unblocked loop reads about 10 to 11 ms. The excess over 10 ms is the time the loop was busy. The histogram resets at `agent_end`.
- **Clean idle CPU ms.** `process.cpuUsage()` over the 10 s after the idle step, with the event-loop sampler disabled. Nothing in the benchmark wakes Pi here, so any CPU is periodic work by Pi or an extension. The record also carries the voluntary and involuntary context switches from `process.resourceUsage()` and the PTY bytes for the same window.
- **Echo latency p50 and p95.** The time from writing `q` to the first output whose ANSI-stripped text contains the whole run of `q`s typed so far. Pi must handle the key and redraw the editor line. The run of `q`s rules out the kernel's own echo and stray `q`s in the output. The workload text contains no `q`.
- **Echo misses.** Keystrokes with no echo within 1 s.
- **PTY bytes.** Bytes Pi wrote to the terminal, bucketed by read time into the workload step, the idle step, and the idle step after its first second. The first second holds the one redraw that clears the working indicator. Any bytes after it point to periodic output.
- **Tool results and errors.** `tool_execution_end` events and their `isError` flags.
- **Workload wall ms.** Wall time of the workload step. The script's sleeps set most of it, so it mostly shows that the run did the scripted work.

The benchmark does not measure the terminal emulator's paint time or how a real terminal handles the bytes. Echo latency stops at the PTY, not at pixels on screen.

## Run the long-session benchmark

```sh
python3 run.py --workload long --runs 5 --out results-long.jsonl
node report.ts results-long.jsonl
```

`--workload long` measures a restored session instead of a streamed turn. Each run writes the conversation from `visual/mockup-fixture.ts`, repeated 150 times, into a fresh workspace. That is 1050 tool calls. It starts Pi on the session file with `--session <file>`.

This workload drops the bench provider and `--no-session`. It keeps the other shared flags, the configurations, the 120x40 PTY, and the fresh `PI_CODING_AGENT_DIR`. The driver runs six steps and times each one until the output settles:

1. `startup`. Time from spawn.
2. `narrow`. Resize to 90x40 with `TIOCSWINSZ` on the master, which sends Pi `SIGWINCH`.
3. `wide`. Resize back to 120x40.
4. `expand`. Press Ctrl+O, which expands every tool row. After the step settles, type ten `q` characters at 250 ms intervals. Measure echo latency and misses as in the stream workload. Clear the editor with Ctrl+U.
5. `collapse`. Press Ctrl+O again.
6. `storm`. Resize five times back to back, to 90, 120, 90, 120, and 90 columns.

A step settles when Pi writes nothing for 500 ms. Its time runs to the last byte before that quiet period. A step with no output within 5 s has no output and counts as a problem. For `startup` the limit is 60 s. A step still writing after 60 s times out and fails the run.

Each step records its bytes and the widest horizontal rule it drew. A resize whose rule does not match the new width is a problem. A rule two columns narrower also passes, because snoop's editor rules are inset by one gutter column on each side. The `storm` step passes when its last rule is 90 columns wide, or 88 for an inset rule.

Two more measurements run between `startup` and `narrow`, with every row collapsed:

- The driver types 20 `q` characters at 100 ms intervals and records their echo latency and misses as `collapsedEcho`.
- After Ctrl+U, it writes 50 `q` characters back to back. It records the time until the whole run of 50 appears as `burst`.

After `storm`, the driver restores 120 columns, so exit bytes stay comparable. It then sends Ctrl+D. It reads the child's user and system CPU for the whole run from `os.wait4`, and it counts the bytes Pi wrote on exit. The whole-run CPU includes all steps.

`report.ts` prints one section per workload. It drops a metric when a record lacks it, so older result files still report.

`node summary.ts label=results.jsonl ...` prints the headline metrics of each file in one table. The columns are:

- the `stock` and `full` medians,
- the paired difference,
- the rounds where `full` was lower,
- two verdicts.

The strict verdict needs the paired min..max to exclude 0. The sign-test verdict needs `full` to be lower, or higher, in at least 13 of 15, 7 of 9, 6 of 7, or 5 of 5 rounds. Any other round count throws an error. `--config` and `--baseline` pick other configurations. `results/final.md` uses this script.

## Run the mixed-tool benchmark

```sh
python3 run.py --workload mixed --runs 5 --configs stock,full --out results-mixed.jsonl
```

`--workload mixed` runs the long-session steps on a session from `mixed-fixture.ts`. The session has 50 turns of six tool calls each, which is 300 tool rows.

Half the rows call `codemode`, `pi_spawn`, and `tmux_run`. `bench-provider.ts` registers these with no `renderCall` or `renderResult`, the way pstack registers them. Their results hold 20 to 200 lines of text. Five `codemode` results and three `tmux_run` results fail. The other half of the rows are `read`, `edit`, and `bash`.

The run loads `bench-provider.ts` and adds the three tools to `--tools`. Stock draws them with Pi's fallback, which shows the tool name and arguments, then the first 10 lines of output in a padded `Box`. Records carry `"workloadName": "mixed"`.

## Run the startup and medium-session benchmarks

```sh
python3 run.py --workload startup --runs 5 --out results-startup.jsonl
python3 run.py --workload medium --runs 5 --out results-medium.jsonl
```

`--workload startup` starts Pi with the stream workload's flags and an empty in-memory session. It times spawn to the first settled frame (500 ms quiet), sends Ctrl+D, and reads the process CPU from `os.wait4`.

It then starts Pi again with `PI_STARTUP_BENCHMARK=1 PI_TIMING=1`. Pi initializes the interactive mode, exits, and prints its own startup steps plus the import and factory time of each extension. The record keeps those as `timingsMs`.

`--workload medium` runs the stream workload on a restored session from `medium-fixture.ts`. The session has 30 turns of Markdown with code blocks and five tool calls each, which is 150 tool rows. The record carries `"workloadName": "medium"`.

Every step and typing record carries a `windowUs` pair on the same monotonic clock as Node's `process.hrtime`. A profile can be cut to that window.

## Profile a run

`NODE_OPTIONS` reaches Pi's Node process through the `pi` launcher. Profile in a run you do not report, because the profiler slows Pi down.

```sh
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$TMPDIR/prof-full" python3 run.py --runs 1 --configs full --out "$TMPDIR/prof.jsonl"
node profile-summary.ts "$TMPDIR/prof-full" --record "$TMPDIR/prof.jsonl"
```

`profile-summary.ts` prints the top self-time functions and the share that falls in `pi-snoop-tui/src/`. With `--record`, it keeps only the samples between `agent_start` and `agent_end` of the last record in that file. `--phase` picks another window from that record. The values are `idle`, `cleanIdle`, `typing` for collapsed typing, `expandedTyping`, `burst`, `startup`, or a long-session step name such as `storm`.

The script also buckets busy time by owner. Each sample goes to the innermost class in its stack. Pi ships as a minified bundle, so the script finds class bodies in the bundle source by matching braces. It prints owner self time, inclusive time per class, and self time per file.

## Capture screenshots

The `visual/` scripts render Pi frames to PNG for visual review. They write to `visual/out/`, which git ignores.

- `node capture.ts <label> <cols> <rows> [pi args...]` starts Pi in tmux on a replayed session. It waits for the frame to settle and saves `.ansi` and `.txt` captures. Set `FIXTURE` to use your own session file. Set `KEYS` to send keys and capture again.
- `node mockup-fixture.ts <out.jsonl> <cwd> [repeats]` writes the default replay session. It holds a read, an edit, a passing and a failing bash call, a grep, an image read, and a codemode call.
- `pty-capture.py <out-prefix> <cols> <rows> <session.jsonl> [--expand] [--page-up=N] -- [pi args...]` does the same in a PTY through `pyte`. Use it in sandboxes where tmux cannot open its socket. Run it with `uv run --with pyte`.
- `ansi2png.py <in.ansi> <out.png>` renders a capture with Pillow. Run it with `uv run --with pillow`.

## Record the README demo

```sh
cd extensions/pi-snoop-tui/bench/visual
uv run --with pyte python3 record-demo.py && uv run --with pillow python3 make-gif.py
```

`record-demo.py` starts Pi in a 100x32 PTY in a fresh git workspace on `main`. It uses a fresh `PI_CODING_AGENT_DIR` whose `settings.json` sets `quietStartup`, `collapseChangelog`, and `hideThinkingBlock` to `true`, `lastChangelogVersion` to `1.5.2`, and `outputPad` to `1`. It drops inherited `npm_config_*` variables, then sets `npm_config_update_notifier` and `npm_config_fund` to `false`.

Pi runs with `--no-extensions -e <package> -e demo-provider.ts --provider demo --model demo-model --thinking medium --no-session --offline --no-skills --no-prompt-templates --no-context-files --tools read,bash,edit,grep --use-theme snoop-dark`.

The provider registers the scripted `demo/demo-model` model and writes a small TypeScript project on `session_start`. Its `npm test` script fails until the second edit adds `signal?.throwIfAborted()`.

The recorder types the prompt and waits for the agent to finish. It then expands and collapses tool rows with Ctrl+O. It saves every distinct screen with its timestamp to `out/demo-frames.json.gz`. It fails if a scripted state never appeared.

`make-gif.py` renders those frames with Menlo, which draws every glyph the rows use, and writes `docs/demo.gif`. It caps idle stretches at 2.5 s and holds the last frame for 2.5 s. Add `--png-dir=<dir>` to also write each frame as a PNG for review. `docs/` is not in the package `files` list, so the README links the GIF by absolute URL.
