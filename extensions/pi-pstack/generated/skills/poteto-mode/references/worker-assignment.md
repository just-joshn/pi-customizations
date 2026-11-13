# Worker assignment examples

Each block below is a complete `assignment.json` for one workspace mode or kind. Write the file to `.pi/pstack/runs/<runId>/workers/<workerId>/assignment.json`, where `runId` and `workerId` name those two directories, then call `pstack_worker` with `{ action: "spawn", runId, assignmentPath }`. Start from the closest example and change only the values.

Every assignment has every field these examples show. `skills` is `[]` when the brief names no skill. `thinkingLevel` is `null` when the model runs at its default level, or one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. `model` is `inherit-parent` or `<provider>/<id>`. A `readonly` path and a `watch.cwd` are absolute, and so is every script path in `watch.argv`. `capabilities` is optional. Leave it out to keep the role's default, as these examples do.

## Writable worker (`worktree`)

The extension creates the worker's git worktree at `inputCommit`, a full or abbreviated commit SHA. `brief` is relative to the worker directory.

```json
{
  "schemaVersion": 1,
  "runId": "fix-login-redirect",
  "workerId": "fix",
  "kind": "pi",
  "role": "poteto",
  "brief": "brief.md",
  "model": "openai/gpt-6.1-sol",
  "thinkingLevel": "low",
  "workspace": {
    "mode": "worktree",
    "inputCommit": "4f2c1a9e0b7d3c5a8e6f1b2d4c9a7e3f5b1d8c6a"
  },
  "skills": [
    "poteto-mode",
    "principle-fix-root-causes"
  ]
}
```

## Readonly worker (`readonly`)

The worker reads `path` with `read`, `grep`, `find`, `ls`, `bash_readonly`, and the MCP tools the operator authorized in `<agent dir>/pstack/readonly-mcp.json`, and writes nothing. Its final reply is its report.

```json
{
  "schemaVersion": 1,
  "runId": "fix-login-redirect",
  "workerId": "explorer-1",
  "kind": "pi",
  "role": "explorer",
  "brief": "brief.md",
  "model": "inherit-parent",
  "thinkingLevel": null,
  "workspace": {
    "mode": "readonly",
    "path": "/Users/you/src/app"
  },
  "skills": []
}
```

## Container worker (`container`)

The worker runs a writable clone at `inputCommit` inside the container that `.pi/environment.json` configures. The container clones the pushed remote, so push `inputCommit` first. Spawn refuses it with `ContainerUnavailable` when no container engine answers, the project has no usable remote, the remote lacks `inputCommit`, or the image cannot be built. Then a step that names a local fallback spawns this assignment again with the `worktree` workspace above, and a step without one reports itself blocked. Its `env` defaults to `minimal`, so it holds only its model provider's credential. A worker here that pushes or posts on the forge adds `"capabilities": { "mcp": "inherit", "env": "minimal", "externalWrite": false, "forge": true }`, which gives it your `gh` token and fails the spawn with `ForgeUnavailable` when you have none.

```json
{
  "schemaVersion": 1,
  "runId": "fix-login-redirect",
  "workerId": "owner-login",
  "kind": "pi",
  "role": "owner",
  "brief": "brief.md",
  "model": "inherit-parent",
  "thinkingLevel": null,
  "workspace": {
    "mode": "container",
    "inputCommit": "4f2c1a9e0b7d3c5a8e6f1b2d4c9a7e3f5b1d8c6a"
  },
  "skills": [
    "poteto-mode"
  ]
}
```

## Watch on an interval (`watch`)

A watch runs `watch.argv` in tmux in `watch.cwd` and wakes the parent once when it exits. It needs no brief. Spawn a fresh one after each wake until the stop predicate holds.

```json
{
  "schemaVersion": 1,
  "runId": "fix-login-redirect",
  "workerId": "audit-tick-1",
  "kind": "watch",
  "role": "watcher",
  "model": "inherit-parent",
  "thinkingLevel": null,
  "workspace": {
    "mode": "readonly",
    "path": "/Users/you/src/app"
  },
  "skills": [],
  "watch": {
    "argv": [
      "sleep",
      "3600"
    ],
    "cwd": "/Users/you/src/app"
  }
}
```

## Watch on an event (`watch`)

An event watch runs the watcher's command by absolute path. Here `<pi-pstack>`, the absolute pi-pstack package root supplied by the extension in the system prompt, is `/Users/you/.pi/agent/npm/node_modules/@justjoshn/pi-pstack`.

```json
{
  "schemaVersion": 1,
  "runId": "fix-login-redirect",
  "workerId": "pr-1234-watch",
  "kind": "watch",
  "role": "watcher",
  "model": "inherit-parent",
  "thinkingLevel": null,
  "workspace": {
    "mode": "readonly",
    "path": "/Users/you/src/app"
  },
  "skills": [],
  "watch": {
    "argv": [
      "/Users/you/.pi/agent/npm/node_modules/@justjoshn/pi-pstack/generated/skills/poteto-mode/scripts/watch-pr/watch-pr",
      "--pr",
      "1234"
    ],
    "cwd": "/Users/you/src/app"
  }
}
```

## Evidence receipt

A receipt is one JSON file for one check you ran. A writable worker saves it under its worker directory's `evidence/` and registers it with `pstack_evidence` `record` (`{ action: "record", runId, receiptPath }`). The parent saves its own under the run directory. `record` rejects a field not listed here and names the field it rejects.

- `schemaVersion`: the number 1.
- `id`: letters, digits, ".", "_", "-"; starts with a letter or digit; at most 128 characters.
- `runId`: the run's id, the folder name under .pi/pstack/runs.
- `target`: a TODO step id, worker id, or commit; non-empty.
- `kind`: one of test, command, screenshot, trace, review, measurement, other.
- `verdict`: one of pass, fail, inconclusive.
- `commit`: the commit SHA the check examined, or null.
- `environment`: text saying where the check ran.
- `command`: optional; the command as an array of strings.
- `exitCode`: optional; the command exit status, an integer.
- `artifacts`: an array of { path, sha256 }, [] when there is no file; path is relative to the run root or absolute inside it; sha256 is 64 lowercase hex characters of the file.
- `defects`: optional; an array of strings.
- `reason`: optional; text.
- `expectedFail`: optional; true marks an intended failing-before proof: verdict pass then means the command failed as intended, and exitCode must be non-zero. verify then reads the recorded output and confirms the tests named in expectedFailTests failed for expectedFailReason, with the reason inside the failure of each named test itself (its per-test result, or the JSON or TAP results of the runner), and that the run did not fail from a crash, a syntax error, a missing file, or zero tests run.
- `expectedFailTests`: required with expectedFail; the failing test names or assertion text the output must show failing, as they appear in it.
- `expectedFailReason`: required with expectedFail; text from the failure message that states why they fail, which the output must contain.
- `createdAt`: an ISO timestamp string.

`pstack_evidence` `verify` takes a `target` and re-checks every receipt recorded for it. A missing receipt is `inconclusive`. A `pass` with no artifacts is `inconclusive`, because it is an assertion and not evidence. A `pass` whose `exitCode` is not 0 fails, unless `expectedFail` is `true`. A `fail` receipt makes the target fail. `verify` also fails a receipt whose artifact is missing or does not match its `sha256`, and, when the target is a commit, one whose `commit` differs.

To prove a check fails before the fix, run it and record a receipt with `expectedFail: true`, `verdict: "pass"`, the non-zero `exitCode`, and the failing output as the artifact, under its own target such as `<step>-before`. Name the failing tests (or assertion) in `expectedFailTests` and the failure message text in `expectedFailReason`. `verify` reads the recorded output and is `inconclusive` without those fields or when the output holds no per-test results to tie a failure to a name, and `fail` when a named test is not shown failing, the reason is not in that test's own failure, or the output shows a crash, a syntax error, a missing file, or zero tests run. Record the passing run after the fix under the step's target. A receipt without `expectedFail` that says `pass` with a non-zero `exitCode` is rejected as contradicting itself.

```json receipt
{
  "schemaVersion": 1,
  "id": "repro-before",
  "runId": "fix-login-redirect",
  "target": "4-before",
  "kind": "test",
  "verdict": "pass",
  "expectedFail": true,
  "commit": "4f2c1a9e0b7d3c5a8e6f1b2d4c9a7e3f5b1d8c6a",
  "environment": "worker worktree, node 22",
  "command": ["npx", "vitest", "run", "redirect.test.ts"],
  "exitCode": 1,
  "expectedFailTests": ["redirects to the page the user asked for"],
  "expectedFailReason": "expected '/login' to equal '/orders'",
  "artifacts": [{ "path": "workers/fix/evidence/repro-before.txt", "sha256": "<64 hex characters of that file>" }],
  "createdAt": "2026-11-12T10:00:00Z"
}
```
