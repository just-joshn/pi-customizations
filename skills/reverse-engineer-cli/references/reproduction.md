# Reproduction helpers

The bundled scripts require Python 3.10+ and only its standard library. `probe.py` uses POSIX PTYs, process groups, and signals, so run it on Linux or macOS. For Windows targets, implement equivalent native capture with the same evidence fields; running under WSL does not reproduce native Windows behavior.

Resolve the skill's script path from SKILL.md. Initialize from the investigation parent directory:

```sh
python3 /absolute/skill/scripts/investigate.py init --workspace .re --target /absolute/path/tool --artifact /absolute/path/package-entry.js
```

Add `--repository` if available. Initialization refuses an existing workspace, copies helpers and artifacts, and records git metadata without invoking the target. If initialization fails partway, inspect the partial evidence and choose a fresh workspace. Do not remove evidence automatically.

Fill null identity fields with observations and evidence references. `hashes.txt` and the `identity.json` artifact array must agree. Add any later-discovered identity-bearing files to both, with their absolute path, resolved path, SHA-256, size, and preserved copy when practical. Replay validates the identity array, including copies. It does not claim the runtime/package closure is complete.

For source-only work, use the workspace for source evidence. Once an isolated build is available, initialize a second workspace with that build as target and link the two reports. Do not relabel source-only evidence as observed behavior.

## Case corpus

Edit `.re/probes/cases.json`. This illustrative case must be reviewed and adapted to the actual CLI:

```json
[
  {
    "id": "P-help",
    "question": "Does help succeed and write only to stdout?",
    "safe": true,
    "args": ["--help"],
    "env": {"LC_ALL": "C", "TERM": "dumb", "NO_COLOR": "1"},
    "timeout": 10,
    "expect": {
      "exit_code": 0,
      "signal": null,
      "stderr_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  }
]
```

`safe: true` records the investigator's review; it provides no containment. Do not apply it mechanically to arbitrary commands. Review fixtures, symlinks, wrapper behavior, and external effects first.

Cases accept:

| Field | Meaning |
|---|---|
| `id`, `question`, `safe`, `args` | Required unique ID, hypothesis question, explicit review marker, argv suffix array |
| `env` | String values or null to unset; replay keeps HOME/XDG/TMP paths isolated |
| `seed` | Array of `source:destination` entries; source relative to `.re/`, destination relative to fresh sandbox |
| `stdin_file`, `stdin_text` | Choose one; file paths relative to `.re/` |
| `stdin_mode` | pipe, null, closed, or tty |
| `tty` | none, stdout, stderr, or both |
| `timeout`, `send_signal`, `after` | Positive bounded timeout, optional signal name, delivery delay smaller than timeout |
| `expect` | Assertions for exit_code, signal, timed_out, stdout_sha256, stderr_sha256 |

For example, `"seed": ["repro/fixtures/project:work", "repro/fixtures/user-config:home/.config"]` copies fixtures before snapshots. Destinations escaping the sandbox are rejected. Symlink fixtures can reference external files, so review them. The source/destination separator is a colon; paths containing colons need a different fixture layout.

Use version/help cases for capture, then cases for each major behavior. First run may omit `expect` to gather observations. Inspect the evidence and add justified expectations; never auto-bless results just to obtain a passing run.

```sh
python3 .re/repro/run-all
```

Exit statuses: 0 means recorded assertions passed; 1 means mismatches or failed probes; 2 means invalid workspace/corpus/identity; 3 means observations were collected but at least one case has no assertions. A passing corpus does not establish every claim in the report.

Every replay verifies target/artifact hashes, allocates a new run directory, copies the corpus/identity, and appends records to `probes/results.jsonl`. Each probe uses a fresh home/config/temp/work directory and clean environment starting from PATH. Relative arguments resolve within that work directory. Use seeds for test files. The original executable runs in place because relocating it can change resource discovery; preserved copies are evidence, not automatically runnable substitutes.

## Probe records and limitations

`probe.py --help` documents individual experiments. It retains `probes.jsonl` within each run for the existing differential consumer. Records contain nested stream metadata plus raw paths, input fixtures, target identity, environment delta, TTY states, exit/signal/timeout, duration, before/after snapshot paths, filesystem diff, and `network_observed: null`. Launch failure is a separate error, never an invented target exit status.

Repeated IDs allocate new raw files and sandboxes. Never merge stdout and stderr. Cross-stream ordering is not reconstructed from separate files; attach timestamped runtime evidence if order matters. PTYs may translate line endings and echo input. stdin TTY is a separate terminal from stdout/stderr; full-screen or job-control applications may need a dedicated controlling-terminal driver. The helper appends an EOF character in canonical TTY input, which an application in raw mode may treat as data. Do not confuse that with pipe EOF.

The runner captures output in memory; use bounded-output probes or adapt it to stream to disk for large outputs. Snapshots hash regular files and record modes/symlinks, but omit ACLs, xattrs, hardlink identity and transient effects. A racing/inaccessible filesystem can fail capture; retain the error and use a trace. Timeouts kill process groups; detached descendants may escape them. Use an OS sandbox for process containment. A descendant holding streams is marked and treated as failed corpus execution.

Use a serial writer per workspace. Separate workspaces for concurrent investigations. Store no production secrets in arguments, fixtures, env, previews, or raw output. `--clean-env` reduces inherited state; it cannot stop reads of system/global config or network access.

## Extend to complete the investigation

The portable core checks byte hashes and process outcomes. Add reviewed, target-specific replay steps for:

- filesystem assertions and transient/read traces;
- network/process observations and controlled endpoints;
- alternate cwd, broken pipe, interactive conversations, and protocol checks;
- algorithm fixtures and normalized output comparison;
- runtime/compiler version capture beyond target version cases.

Keep these scripts and tool prerequisites under `repro/`, invoke them from `run-all`, and preserve their raw output and exit status. A missing required tracer is a reported gap, never a passing check.

Normalize only fields demonstrated to be nondeterministic. Store rules with evidence, raw output, normalized output, and comparisons in separate files. Never overwrite raw evidence or normalize whole paths/messages without establishing which part varies.

For release comparison, initialize separate workspaces, copy the same reviewed cases/fixtures, replay both, then compare command trees, defaults, precedence, raw streams, statuses, effects, and timing categories. Do not transfer baseline assertions blindly when the task is to discover changed behavior.

A reviewer needs matching target/runtime/package artifacts, helpers, fixtures, and recorded PATH/tool dependencies. If relocating the workspace or target, explicitly remap paths while retaining hashes and original identity provenance. Absolute evidence paths are machine-local until remapped. Hashes verify recorded files; they do not prove all dependencies were captured or prevent a target from changing during execution.
