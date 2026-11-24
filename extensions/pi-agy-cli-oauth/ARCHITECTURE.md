# Architecture

This document explains how `pi-agy-cli-oauth` works internally. For installation
and usage, see [README.md](README.md).

## Overview

The extension registers a Pi provider that routes every Antigravity model
request through the official Antigravity CLI, `agy`. It talks to the CLI over
the Agent Client Protocol (ACP), the JSON-RPC interface `agy acp --stdio`
serves for external editors, and translates the streamed turn back into Pi's
message format.

Pi stays responsible for conversation history, approvals, compaction, and tool
execution. The CLI talks to the model. It never runs a tool.

## Why ACP and not print mode

`agy -p --output-format stream-json` also produces a machine-readable turn, and
it is the closer analogue of Claude Code's `claude -p`. It was rejected for one
reason: print mode gives the client no say over tool execution.

ACP does. `agy acp` routes every gated tool call to its client as
`session/request_permission`, and the client picks the outcome. That is the seam
this extension needs, and it is a documented protocol instead of an interception
point. The CLI likewise reports each model, mode, and thinking level through
`session/new`, so the catalog is read from the CLI rather than guessed.

Everything below was read from a live `agy acp --stdio` session on `agy` 1.5.15,
from a real turn and a real tool call, or from the CLI's own JSON tag literals.
`scripts/verify-live.ts` reproduces the observations.

## Authentication

The CLI owns and stores its credentials, in the macOS Keychain with a file
fallback. The extension does not read credential files, refresh tokens, or
persist them. There is no token handling anywhere in this code.

The provider has an ambient API-key-style auth method without a login flow. Its
`check()` connects to the CLI, completes `initialize` and `session/new`, and
reports the provider as configured only when both succeed, so Pi hides the
models otherwise. Requests resolve to a placeholder key. It reports the
signed-in account as OAuth-shaped auth so Pi labels the models as a
subscription, and declares an `oauth` method marked `isSubscription` only so
Pi's subscription-aware UI works. That method's `login()` never starts a flow;
it tells the user to sign in with `agy` itself.

Child processes do not inherit `GEMINI_API_KEY` or `GOOGLE_API_KEY`. A key-backed
turn is billed to the paid Gemini API instead of the signed-in plan, so
inheriting one would change what a request costs without saying so. Set
`PI_AGY_INHERIT_API_KEY=1` to pass them through. The parent environment is never
modified.

## The tool invariant

The model must never execute anything. Two mechanisms hold that line, and
neither depends on the other:

1. **Nothing is approved.** Every `session/request_permission` is answered with
   the CLI's own `reject_once` option, or `reject_always`, or a cancelled
   outcome. No `allow_once` or `allow_always` option is ever selected, and
   `--dangerously-skip-permissions` is never passed. The decision is not
   configurable.
2. **The turn ends at the first tool request.** Once a tool call has been
   captured, the extension cancels the CLI turn and settles. Even a CLI bug that
   ignored the rejection could not turn one Pi turn into several CLI turns.

A CLI tool that needs no approval still arrives as a `tool_call` session update,
which is captured the same way. The turn is cancelled before its result matters,
so the CLI's copy of a read is always discarded in favour of Pi's.

Both paths end the turn, including the ones where the tool does not map onto a
Pi tool: approving an unmapped request would let the CLI act on its own, so the
request is refused and the turn stops either way.

## Tool bridging

Pi's tool names are not the CLI's. A captured call is translated by a table:
`run_command` to `bash`, `view_file` to `read`, `write_to_file` to `write`,
`replace_file_content` and `multi_replace_file_content` to `edit`,
`grep_search` to `grep`, `find_by_name` to `find`, `list_dir` to `ls`. The CLI
sends PascalCase argument names, so each entry also maps arguments explicitly.

`sed_file` is deliberately not mapped. A sed expression can be addressed,
global, repeated, or ordered, and Pi's `edit` is one unique old/new pair, so an
approximate translation could rewrite the wrong occurrence. Refusing it costs one
dropped call; guessing could cost the user's file.

A call is dropped when its target tool is not in the request's declared tool
set, when a required argument is missing, or when the CLI tool has no entry.
Dropping is deliberate: Pi cannot execute a tool it was not given, and a
fabricated tool name would fail one round trip later with a worse error.

## Instructions

The CLI brings its own sixty-tool inventory, so it has to be told to use Pi's
instead. `initialize` advertises `_meta.antigravity.systemPrompt.append`, and
`session/new` accepts text on that channel. Pi's current system prompt and a
tool contract are sent together there, rebuilt each turn from the actual
declared tools.

Sending it through a plain `systemPrompt` string is silently ignored, and so is
the same field on `session/prompt`; only the `append` object on `session/new`
reaches the model. That was measured, not assumed: a Pi system prompt saying
"answer with exactly the word BANANA" produced `BANANA` through this code path.

When the capability is absent, the same text leads the prompt as a text block
instead of being dropped.

## Per-turn session

Each Pi turn gets a fresh ACP session, and the whole conversation is replayed
into it as one prompt.

Replay is not an optimization left for later. Pi owns the transcript, and the
CLI's own state diverges from it by construction: the CLI's tool results are
discarded, and its internal history would contain actions Pi never performed.
Reusing a session would mean letting the CLI reason over a history Pi cannot
see. The extension therefore treats Pi's messages as the only truth.

The cost is real and worth stating: every turn re-sends the conversation, so
prompt caching is weaker than a native provider's, and a long conversation costs
more input tokens per turn. The benefit is that branching, editing an earlier
message, and changing settings mid-conversation need no special handling, which
is where the reference implementation spends most of its complexity.

The ACP process itself is pooled: up to two `agy acp` processes stay warm, and a
process idle for more than five minutes is closed. A session is never reused.

## Failure classification

The CLI reports account blocks as ordinary assistant text, not as a protocol
error. A 1.5.15 account blocked for third-party use answers `session/prompt`
with `stopReason: end_turn` and one assistant message reading "This service has
been disabled in this account for violation of Terms of Service".

Matching that text is the only way to tell a refusal from a short answer, so the
extension rewrites it into a non-retryable error naming the policy and what to
do about it. The same applies to the CLI's enterprise-policy strings. A `refusal`
stop reason, a cancelled turn, a `max_tokens` stop, a transport failure, and a
child process that exits mid-turn each map onto a distinct Pi stop reason so Pi's
retry behaviour stays correct.

## Usage and cost

The CLI reports the turn's tokens on the prompt result:
`{inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens, thoughtTokens,
totalTokens}`. Those map onto Pi's usage fields, with `thoughtTokens` reported
as the reasoning subset of `output`.

A turn that ends at a tool call is cancelled before the CLI finishes, so the
prompt result is not ready at the moment the turn has to settle. The stream
waits up to `CANCEL_USAGE_GRACE_MS` for the cancelled result, which the CLI
does return with the usage attached. When it does not arrive, the turn reports
zero tokens rather than an estimate.

Cost is always zero. A plan turn has no per-token price Pi can bill, and
inventing one would misreport a bill the operator never sees.

The CLI also reports context use on `usage_update`, which the extension keeps as
an `antigravity-context` diagnostic on the assistant message.

## Verified against the real CLI

`scripts/verify-live.ts` runs the production code against `agy` 1.5.15 and
prints what it observed:

- `initialize`, `session/new`, `session/set_config_option` for the model and for
  `thought_level`, `session/close`;
- the catalog, with `gemini-3.8-flash` collapsing three effort variants onto one
  model that offers `low`, `medium`, and `high`, and Claude entries offering none;
- a text turn, which produced `hello` with real token counts;
- a tool turn, where the model called `run_command`, the extension answered the
  permission request with the CLI's own `reject_once` option, and Pi received one
  `bash` call with `{command: "ls -la"}` and `stopReason: toolUse`;
- a system-prompt turn, where a Pi system prompt sent over the append channel
  changed the model's answer.

The `session/update` variants seen live are `available_commands_update`,
`usage_update`, `session_info_update`, `tool_call`, `tool_call_update`, and
`agent_message_chunk`. `agent_thought_chunk` is handled the same way as
`agent_message_chunk` and is covered by tests.

## Account blocks

On 1.5.15 a blocked account answers a turn with an assistant notice instead of
model output: "This service has been disabled in this account for violation of
Terms of Service." That was observed on this machine in both print mode and ACP,
and it later cleared with no code change. Because the notice arrives as ordinary
text, matching it is the only way to tell a block from a short answer, so the
extension rewrites it into a non-retryable error that names the policy.

`PI_AGY_ALLOW_POLICY=1` leaves the notice as text for a single stop, which is
useful when diagnosing whether a block is really a block.

## Drift

The extension tolerates what the CLI can change without warning: unknown
`sessionUpdate` values are ignored, unknown JSON-RPC fields are ignored, and a
tool whose arguments no longer match a bridge entry is dropped instead of being
passed through. The failure mode of drift is a missing block or a dropped tool
call, never a tool the CLI ran itself.
