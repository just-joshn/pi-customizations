# Testing

Four suites, each at a different distance from the real harness. The first three are deterministic and
run on every `bunx vitest run`. The fourth is opt-in and uses a real provider.

## Unit: `test/unit-layer.test.ts`

Covers the four layer contracts directly, with no agent loop.

- **Argument validation** runs through Pi's real validator (`@earendil-works/pi-ai/utils/validation`), not
  a copy. Every tool's schema is checked with valid arguments, a missing required field, a wrong type, and
  Pi's own coercions. `prepareArguments` is applied first, the way the dispatcher does.
- **Authorization** checks the policy matcher: inside versus outside the workspace, deny on the canonical
  path, allowlist requiring the canonical target, and command globs that normalize whitespace and cross
  `/`. Command analysis is asserted for wrappers, assignments, substitutions, and nested shells.
- **Result normalization** asserts the `content`/`details`/`structuredContent` shape on success and the
  `isError` shape on failure, including a typed `failure` in details.
- **Error handling** maps errno codes to failure kinds, preserves a thrown layer error, and turns an
  already-aborted call into a rejected result.

`test/core.test.ts` and `test/core2.test.ts` hold the remaining unit coverage for paths, text, policy,
ignore parsing, repair, metadata, the read fence, and the process runner.

## Integration: `test/integration-dispatch.test.ts`

Drives Pi's real agent loop in process with `createAgentSession`, a `DefaultResourceLoader`, and the
extension factory. The model is the deterministic fake server, so the scripted assistant turns are exact:

1. A `write` call with a missing argument, to prove Pi's validator rejects it and the error reaches the
   model as a tool result.
2. A `write` and a `bash` call in one turn, to prove real local tools run, files appear on disk, and both
   results go back in the next request.
3. A final text turn, asserted through `session.getLastAssistantText()`.

The factory is passed inline (`extensionFactories`) rather than as a path so the test and the agent share
one module instance. A second load through a different transform would produce a second coverage view of
the same files and skew the coverage report.

## End to end: `test/e2e-cli.test.ts`

Runs the real `pi` executable against an isolated profile and workspace.

- `PI_CODING_AGENT_DIR` points at a temp directory whose `models.json` names the fake provider.
- `-e src/index.ts` loads the extension exactly as a user would.
- The fake server scripts the turns over an OpenAI-compatible SSE endpoint and records every request.
- `--mode json` events are parsed, so the test asserts `tool_execution_end` names, error flags, and the
  tool result text the model received.

Observable output is real: files written by `write`, files and a process pid written by `bash`, and a
permission denial produced by the real configuration loader (`PI_TOOLS_RULES`).

No LLM is involved. The server is a local `node:http` listener that never leaves the machine.

## Live: `test/live-model.test.ts`

Opt in with `PI_TOOLS_LIVE=1`. It uses the developer's configured profile and a real model
(`PI_TOOLS_LIVE_MODEL`, default `deepseek-flash`) to check that the extension loads and a real provider
can call a layer tool. It costs money and can fail on model behavior, so it is skipped by default.

```bash
bunx vitest run                      # unit, integration, e2e
bunx vitest run --coverage           # same, with the 80% thresholds
PI_TOOLS_LIVE=1 bunx vitest run test/live-model.test.ts
```

## The fake model server

`test/support/fake-model-server.ts` implements `POST /v1/chat/completions` as a scripted SSE stream. Each
`FakeTurn` is either a list of tool calls or a text reply. Requests are recorded as
`{ model, messages, toolNames }`, which is how tests assert what the model was offered and what the
dispatcher sent back. The server binds to `127.0.0.1` on an ephemeral port and is closed in `afterEach`.

`test/support/fake-model.ts` writes the matching `models.json` and builds the SDK model object.

## Coverage

Thresholds are 80% for statements, branches, functions, and lines, enforced in `vitest.config.ts`.
Subprocess runs (the CLI suite) are separate processes and are not merged into coverage. The in-process
integration suite is, which is why it loads the extension by factory instead of by path.
