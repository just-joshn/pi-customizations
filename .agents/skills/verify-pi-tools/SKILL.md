---
name: verify-pi-tools
description: Drive the pi-tools Pi extension through the real `pi` CLI with a deterministic fake model and prove filesystem, search, policy, and shell behavior end to end. Use when verifying a pi-tools change, reproducing a tool-layer bug, or capturing evidence for a release.
---

# Verify pi-tools

pi-tools is a Pi package that replaces Pi's local tool layer. Its user-facing surface is the Pi CLI.
A model asks for a tool, Pi dispatches to the extension, and the tool touches real files and real
processes. There is no web UI. The harness drives the real CLI against a scripted OpenAI-compatible
server, so every run is deterministic, offline, and free.

## Launch

Preconditions: `bun` and `pi` are on `PATH`, and the extension dependencies are installed
(`cd extensions/no-ceilings/pi-tools && bun install`). Each run creates its own temp workspace and Pi
profile, starts the fake model on an ephemeral port, and launches

```
pi --print --mode json --provider fake --model fake/fake-model \
  --tools <scenario tools> -e extensions/no-ceilings/pi-tools/src/index.ts "<scenario prompt>"
```

with `PI_CODING_AGENT_DIR` pointing at the temp profile. There is no long-lived server to start by
hand; the run command is the launch. From the repo root:

```
bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature <files|search|policy|shell>
```

Ready means the script prints `result: PASS` and an `evidence:` path. The script closes the fake
server and removes the temp root on success or failure.

## Doctor

```
bun .agents/skills/verify-pi-tools/scripts/verify.ts doctor
```

Reads only. It checks that `pi` and `bun` answer, the extension entry exists, dependencies are
installed, the fake model support files exist, and the evidence directory is writable. `doctor: ok`
means the instance is worth driving. Run it first when a scenario fails to start.

## Drive

The helper owns four scenarios, one per mapped feature. Pick a feature ID rather than writing an
ad-hoc prompt:

| Feature | What it drives | Tools |
| --- | --- | --- |
| `files` | write a file, read it back, edit it, check the bytes | write, read, edit |
| `search` | grep, find, and ls with a `.piignore` filter | grep, find, ls |
| `policy` | denied read, denied write, and an outside write | read, write |
| `shell` | shell stdout, then a denied command | bash |

The fake model is scripted. Each scenario's `turns` array is the exact sequence of tool calls and the
final assistant text. To add a scenario, add an entry to `scenarios` in `scripts/verify.ts`, give it a
`check` that asserts both the `tool_execution_end` events and the files on disk, then run it once and
keep the evidence. The feature files under `features/` describe the user entry points and the
observable end state for each scenario.

## Evidence

Every run writes `.agents/skills/verify-pi-tools/evidence/<timestamp>-<feature>/`:

- `command.txt` - the temp workspace and the exact `pi` argv.
- `stdout.jsonl` - the CLI JSON event stream, including tool results.
- `events.json` - the parsed events.
- `files.json` - the workspace files the scenario inspects, read after Pi exits.
- `summary.txt` - feature, exit code, model turns, one line per tool result, and PASS or FAIL.
- `stderr.txt` - anything Pi wrote to stderr.

Proof standards: a pass requires the tool event and the file state. Assistant text alone is not
proof. Do not edit `files.json` or `summary.txt` to make a run pass; fix the behavior or report the
failure with the evidence path. Evidence survives cleanup, and `evidence/.gitignore` keeps it out of
git.

## Cleanup

The script closes the fake server and removes its temp root in a `finally` block. Do not kill
processes by name. If a run is killed before cleanup, `command.txt` names the temp workspace; remove
that directory and confirm no `pi` child from the run is still alive. Never remove the evidence
directory.

## Helpers

`scripts/verify.ts` is the only helper. Its two invocations are shown above. It imports
`test/support/fake-model-server.ts` and `test/support/fake-model.ts` from the extension, so the fake
model cannot drift from the E2E suite. The script runs from the repo root and resolves the repo from
its own location.

Isolation: temp directories, an ephemeral port, and a temp `PI_CODING_AGENT_DIR`. Two runs can go
side by side, and the user's `~/.pi` is never touched. No real model call is made.

See `features/README.md` for the maintained feature map.
