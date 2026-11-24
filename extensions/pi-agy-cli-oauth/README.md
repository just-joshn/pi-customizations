# pi-agy-cli-oauth

Use your Antigravity CLI account in Pi by routing every model request through the
official `agy` CLI.

Pi still handles conversation history, approvals, compaction, and tool
execution. The CLI only talks to the model. It never runs a tool.

> [!WARNING]
> **This treats the CLI as a model backend, which its vendor may not permit.**
> The extension sends Pi's conversation to the same endpoint the CLI uses for its
> own agent sessions, and it ends every turn as soon as the model asks for a
> tool. Whether that counts as ordinary Antigravity usage or as third-party
> usage the vendor blocks is decided by Google, not by this extension.
>
> A blocked account answers with "This service has been disabled in this account
> for violation of Terms of Service". That was observed on the machine this was
> built on, in both the CLI's print mode and its ACP mode, and it cleared later
> with no code change. If it happens to you, the extension reports the block as a
> non-retryable error rather than retrying it or hiding it.

## Requirements

- Pi
- [Antigravity CLI](https://antigravity.google), installed and on your `PATH` as
  `agy`:

  ```sh
  agy install
  ```

- An Antigravity account you are signed in to with the CLI

## Installation

```sh
pi install npm:@justjoshn/pi-agy-cli-oauth
```

Then pick a model from the **Antigravity CLI (Experimental)** provider in Pi.

## Login and logout

The Antigravity CLI handles authentication. Sign in and out with the CLI itself:

```sh
agy                      # sign in on first launch
```

or, for a headless machine, the ACP entry point's own login flag:

```sh
agy acp --login
```

The extension uses whatever account the CLI currently holds. You do not need
Pi's `/login` or `/logout` for this provider. It does not read, copy, or store
your CLI credentials.

Run `/antigravity-status` in Pi to check that the CLI is installed, signed in,
and which plan it reports.

## Configuration

These environment variables are optional:

- `PI_AGY_COMMAND`: path or name of the Antigravity CLI executable
  (default: `agy`).
- `PI_AGY_GEMINI_DIR`: passed to the CLI as `--gemini-dir`.
- `PI_AGY_APP_DATA_DIR`: passed to the CLI as `--app-data-dir`.
- `PI_AGY_TELEMETRY=1`: keep the CLI's telemetry enabled for conversation
  turns. It is disabled for them by default.
- `PI_AGY_INHERIT_API_KEY=1`: let the CLI see `GEMINI_API_KEY` and
  `GOOGLE_API_KEY`. They are removed from its environment by default, because a
  key-backed turn is billed to the paid API instead of your plan.

## How it works, briefly

Each Pi turn spawns `agy acp`, opens one ACP session, sends Pi's whole
conversation, and reads the streamed answer. The first tool call the model makes
ends the turn: the CLI's permission request is rejected, the CLI turn is
cancelled, and the call is translated into the matching Pi tool for Pi to run. A
tool the CLI would run without asking for permission ends the turn the same way,
and one this extension cannot translate is reported rather than dropped.

Model discovery asks the CLI. `agy` lists effort inside the model id, so the
extension collapses those variants onto one model per family and maps Pi's
thinking levels onto the CLI's own `thought_level` option.

For the details, including what could not be verified against a live account,
see [ARCHITECTURE.md](ARCHITECTURE.md).

## Usage and billing

Requests count against your Antigravity plan's quota and rate limits, exactly as
the CLI's own sessions do. The extension does not give you separate or unlimited
usage.

The CLI reports each turn's tokens, so Pi shows real input, output, and reasoning
counts. Cost stays at zero: a plan turn has no per-token price Pi can bill.

Account blocks are reported as non-retryable errors. Pi will not retry them.

## Limitations

- The extension is experimental.
- Every turn re-sends the conversation, so prompt caching is weaker than with a
  provider Pi can talk to natively.
- The CLI decides which tools it asks permission for. Every tool call ends the
  Pi turn, mapped or not, and the CLI never runs one.
- Tool arguments are translated from the CLI's field names. A CLI that renames a
  field yields a dropped call, never a wrong action.
- Cost is always zero, and a turn that ends before the CLI reports its tokens
  shows zero tokens too.
