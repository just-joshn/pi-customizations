# pi-snoop-tui benchmarks

This directory holds a rerunnable performance benchmark and the visual capture scripts. None of it ships: the package `files` list includes only `src`, `themes`, `README.md`, and `CHANGELOG.md`.

## Run the replay benchmark

You need Pi 1.5.2 on `PATH` as `pi`, Python 3, and `rg` on `PATH` for Pi's `grep` tool.

```sh
cd extensions/pi-snoop-tui/bench
python3 run.py --runs 7 --out results.jsonl
python3 report.py results.jsonl
```

`run.py` appends one JSON object per run to `--out`. `report.py` prints a Markdown table of the median and min..max per configuration, then a table of per-round differences from `stock`. Use `--configs stock,full` to run a subset and `--keep-artifacts` to keep each run's workspace, raw `pty.log`, and chunk timings.

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

The driver waits for the first frame to settle, types the prompt, and presses Enter. While Pi streams, it sends `q` every 250 ms, 10 times. Ten seconds after `agent_end`, the provider appends its record to `SNOOP_BENCH_OUT` and calls `ctx.shutdown()`. The driver merges its terminal metrics into the record. A run whose tool count is not 4, whose edit did not land, or that saw no output or missed an echo gets a `problems` field and keeps its artifacts.

## What each number measures

All in-process numbers come from the Pi process itself. The workload phase runs from `agent_start` to `agent_end`. The idle phase is the 10 s after `agent_end`.

- **Workload CPU ms.** `process.cpuUsage()` user plus system time across the workload phase. Child processes such as the `bash` tool's shell are not included.
- **Idle CPU ms.** The same counter over the idle phase. The event-loop sampler below wakes Pi every 10 ms in every configuration, so this number never reaches zero. Compare it between configurations, not against zero.
- **Event-loop delay p50 and p99.** `perf_hooks.monitorEventLoopDelay({ resolution: 10 })`. Each sample is the time between two 10 ms timer ticks, so an unblocked loop reads about 10 to 11 ms. The excess over 10 ms is the time the loop was busy. The histogram resets at `agent_end`.
- **Echo latency p50 and p95.** The time from writing `q` to the first output whose ANSI-stripped text contains the whole run of `q`s typed so far. Pi must handle the key and redraw the editor line. The run of `q`s rules out the kernel's own echo and stray `q`s in the output, and the workload text contains no `q`.
- **Echo misses.** Keystrokes with no echo within 1 s.
- **PTY bytes.** Bytes Pi wrote to the terminal, bucketed by read time into the workload phase, the idle phase, and the idle phase after its first second. The first second holds the one redraw that clears the working indicator. Any bytes after it point to periodic output.
- **Tool results and errors.** `tool_execution_end` events and their `isError` flags.
- **Workload wall ms.** Wall time of the workload phase. The script's sleeps set most of it, so it mostly shows that the run did the scripted work.

The benchmark does not measure the terminal emulator's paint time or how a real terminal handles the bytes. Echo latency stops at the pseudo-terminal, not at pixels on screen.

## Profile a run

`NODE_OPTIONS` reaches Pi's Node process through the `pi` launcher. Profile in a run you do not report, because the profiler slows Pi down:

```sh
NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$TMPDIR/prof-full" python3 run.py --runs 1 --configs full --out "$TMPDIR/prof.jsonl"
python3 profile-summary.py "$TMPDIR/prof-full" --record "$TMPDIR/prof.jsonl"
```

`profile-summary.py` prints the top self-time functions and the share that falls in `pi-snoop-tui/src/`. With `--record`, it keeps only the samples between `agent_start` and `agent_end` of the last record in that file.

## Capture screenshots

The `visual/` scripts render Pi frames to PNG for visual review. They write to `visual/out/`, which git ignores.

- `capture.sh <label> <cols> <rows> [pi args...]` starts Pi in tmux on a replayed session, waits for the frame to settle, and saves `.ansi` and `.txt` captures. Set `FIXTURE` to use your own session file. Set `KEYS` to send keys and capture again.
- `mockup-fixture.py <out.jsonl> <cwd>` writes the default replay session: read, edit, a passing and a failing bash call, grep, an image read, and codemode.
- `ansi2png.py <in.ansi> <out.png>` renders a capture with Pillow. Run it with `uv run --with pillow`.
