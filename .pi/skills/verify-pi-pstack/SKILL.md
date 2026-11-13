---
name: verify-pi-pstack
description: "Verify the pi-pstack extension (extensions/pi-pstack) through the installed pi CLI in JSON and RPC modes: Task subagents (foreground, background notices, agent_status), background shells (bash_background, terminal files, completion notices), plan mode (/plan, CreatePlan, read-only edits, build dialog), and TodoWrite (list, widget, system prompt), all driven by the package's deterministic scripted model in a scratch agent dir. Use after changing extensions/pi-pstack, before releasing it, or when a pstack host feature regresses."
---

# Verify pi-pstack

Drive `extensions/pi-pstack` the way a user does: the installed `pi` CLI loads the package from `settings.json` `packages` (what `pi install` writes), and the harness exercises it in `--mode json` and `--mode rpc`. The only fake is the model. It is the package's own `scripted/echo` provider (`extensions/pi-pstack/test/fixtures/scripted-model.ts`), which turns a `@@script [...]` line in the prompt into real tool calls. No drive reaches a real model, the network, or `~/.pi/agent`.

Read `features/README.md` before driving, then the feature file for the behavior you need to prove.

## Launch

Pi is a short-lived CLI, so there is no server to keep alive. One-time setup from the repo root:

```bash
bun install --frozen-lockfile
```

Each drive creates `$TMPDIR/verify-pi-pstack-*/` containing:

- `agent/`: `PI_CODING_AGENT_DIR`, with `settings.json` = `{packages: [<repo>/extensions/pi-pstack], extensions: [<scripted-model.ts>], quietStartup: true}`. pstack state lands in `agent/pstack/workspaces/<slug of work/>/` (subagents, terminals, inbox) and `agent/pstack/plans/`.
- `work/`: the cwd of every Pi process.
- `home/`: `HOME`, so `~/.agents/skills` and other user resources stay out.
- `sessions/`: the RPC `--session-dir`.
- `run.json`: the Pi PIDs this run started.

Every Pi process runs as `pi --offline --model scripted/echo --mode json --no-session <prompt>` or `pi --offline --model scripted/echo --mode rpc --session-dir <run>/sessions`, with `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PSTACK_CLOUD_DRIVER=worktree`, and every inherited `PI_CODING_AGENT*`, `PI_SESSION*`, `PI_PSTACK_*`, `PSTACK_*`, `PI_MODEL`, `PI_PROVIDER`, and `PI_REASONING_LEVEL` removed. When you run inside a Pi chat those variables are set and would give the child your session or a subagent identity.

Ready means:

- JSON mode: the process exits. It waits for background subagents and shells to finish, so its event stream includes their completion notices and the follow-up turn.
- RPC mode: a `prompt` gets its `response`. Slash commands answer with `data.disposition: "handled"`; model turns end with `agent_settled`.

Teardown happens in each drive's `finally`: the RPC child gets stdin closed (SIGKILL after 5 s), then the harness SIGKILLs the process group of every PID in `run.json` plus the PID in every subagent record under the scratch workspace, and removes the scratch dir.

## Doctor

Run this first, and again whenever a drive fails strangely:

```bash
./.pi/skills/verify-pi-pstack/bin/control-pstack doctor
```

It checks Node `>= 22.21.0` (the package's `engines`), `pi --version` (drives pass on 1.5.2), that `extensions/pi-pstack/src/index.ts`, its `node_modules`, and the scripted model exist, that a scratch JSON run lists `Task`, `agent_status`, `bash_background`, `AwaitShell`, `TodoWrite`, and `AskQuestion` among its tools, and that no scratch runs are left over. It prints which inherited variables drives remove. It exits `1` on any failure.

## Drive

```bash
B=./.pi/skills/verify-pi-pstack/bin/control-pstack
$B drive task-subagents    # JSON: foreground Task, background Task + completion notice, agent_status
$B drive background-shell  # JSON: bash_background launch, terminal file, notice; blocking call with exit 7
$B drive plan-mode         # RPC: /plan, CreatePlan, write .md ok, edit code blocked, build dialog, /plan off
$B drive todos             # RPC: TodoWrite replace + merge, footer widget, <pstack_todos> in the next prompt
```

Flags: `--out <dir>` writes evidence elsewhere. `--keep` keeps the scratch dir (processes are still killed) and prints its path as `scratch`. Remove kept dirs with `cleanup`.

Each drive prints a JSON report (`status` `PASS`/`FAIL`, `piVersion`, `evidence`, `summary`, first failed assertion in `error`) and exits `0` or `1`.

To drive something by hand, copy the pattern: a scratch `PI_CODING_AGENT_DIR` with the same `settings.json`, the scrubbed environment, and a prompt whose second line is `@@script <json steps>`. Each step is `{"tool":name,"args":{}}`, an array of those (parallel calls), or `{"text":"..."}`. After the last step the model replies `RESULTS:` plus every tool result. Other directives (`@@say`, `@@sleep <ms> <text>`, `@@fail`, `@@sys`, `@@tools-list`) are listed at the top of `scripted-model.ts`. Put the directive on the second line: Pi reads a first-line `@...` argument as a file. Never point a manual run at `~/.pi/agent`.

## Evidence

Each drive replaces `artifacts/verify-pi-pstack/<feature>/` (gitignored) and always writes `run.json` (status, Pi version, platform, summary, error). Every drive also saves the raw Pi event stream (`*.events.jsonl`) and a `results.json` of the texts it asserted on. Feature files list their extra files.

Proof standards:

- Drive the real user paths: `pi --mode json` and `pi --mode rpc` with the package installed through `settings.json`. Do not import extension modules or call unit-test helpers.
- The scripted model is the only fake. It sits at the provider boundary and decides which tools to call; the tools, subagent processes, shells, plan files, and UI requests are all real.
- Assert side effects, not just tool text: the subagent transcript and record on disk, the terminal file with its `exit_code` footer, the plan file contents, a code file left unchanged, the widget lines, and the next turn's system prompt.
- Scope: these drives do not prove TUI rendering, real-model behavior with pstack skills, `/loop` timing, subscriptions or the routines supervisor, cloud agents, or Slack. See "Not mapped yet" in `features/README.md`.

## Cleanup

Drives clean up after themselves even when they fail. For a kept or interrupted run:

```bash
./.pi/skills/verify-pi-pstack/bin/control-pstack cleanup
```

`cleanup` reads each `$TMPDIR/verify-pi-pstack-*/run.json`, SIGKILLs the process groups of the recorded Pi PIDs and of subagent PIDs recorded under that scratch workspace, and removes the directory. It never kills by process name and never touches `artifacts/verify-pi-pstack/`.

## Helpers

- `bin/control-pstack`: an executable Node script with no dependencies beyond Node and `pi`. Subcommands: `doctor`, `drive <task-subagents|background-shell|plan-mode|todos> [--out <dir>] [--keep]`, and `cleanup`. Add a feature by writing a `drive<Name>(run, out)` function, registering it in `DRIVES` and `FEATURES`, and adding a feature file.
- The package's own vitest e2e suite (`extensions/pi-pstack/test/e2e/*.e2e.test.ts`, `bun run --filter @justjoshn/pi-pstack test`) uses the same scripted model with the dev-dependency Pi. Set `PSTACK_E2E_PI=pi` to run it against the installed CLI. It covers far more cases; this skill is the short, evidence-producing user path.
