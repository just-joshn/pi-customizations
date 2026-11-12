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

The worker reads `path` with `read`, `grep`, `find`, `ls`, `bash_readonly`, and MCP tools, and writes nothing. Its final reply is its report.

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

The worker runs a writable clone at `inputCommit` inside the container that `.pi/environment.json` configures. The container clones the pushed remote, so push `inputCommit` first. Spawn refuses a commit the remote lacks. Spawn refuses it with `ContainerUnavailable` when no container engine answers. Then a step that names a local fallback spawns this assignment again with the `worktree` workspace above, and a step without one reports itself blocked. Its `env` defaults to `minimal`, so it holds only its model provider's credential. A worker here that pushes or posts on the forge adds `"capabilities": { "mcp": "inherit", "env": "minimal", "externalWrite": false, "forge": true }`, which gives it your `gh` token and fails the spawn with `ForgeUnavailable` when you have none.

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

An event watch runs the watcher's command by absolute path. Here `<pi-pstack>`, the pi-pstack package root that `pi list` names, is `/Users/you/.pi/agent/npm/node_modules/@justjoshn/pi-pstack`.

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
