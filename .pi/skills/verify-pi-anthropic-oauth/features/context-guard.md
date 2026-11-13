# Context guard

When a session grows on a provider whose tokenizer counts text more cheaply and the user then switches to a `claude-subscription` model, the extension fits the outgoing request under the model window and compacts at the prompt boundary. Without the guard, Anthropic rejects the request with `prompt is too long` and the session wedges.

## Sub-features

- `guard-fit` keeps every subscription request under the 200k window after the switch.
- `guard-compact` lands one compaction after the run settles, with each summarization piece fitting the window.
- `guard-carry` makes the next run carry the compaction summary.

## How to get to it (user POV)

- Grow a long session on another provider, run `/model` to pick a `claude-subscription` model, and keep prompting.

## Driving it with control-claude-oauth

Preconditions:

- `doctor` passes, including `installed pi cli.js`.

- **Run.** `./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth drive context-guard`. The drive runs `scripts/prove-context-guard.ts --expect green` with `PI_OAUTH_CLI_PATH` set to the installed Pi's `cli.js`. The script drives that CLI over RPC against its own local peers.
- **Observe.** The summary shows `=== VERDICT (green, cli <version>) ===` and `PASS the guard compacted before the next run, every subscription request stayed under the window, and the run carried the summary`.
- **Proof.** `artifacts/verify-pi-anthropic-oauth/context-guard/prove-context-guard.txt` holds the full script output, including every recorded request with its size and the verdict.

## Gotchas

- This drive reuses the package's proof script rather than the harness's own peer. The script registers a `probe-foreign` provider to grow the session.
- `--expect red` is only meaningful on a commit that predates the guard. On the current tree it fails by design.
- The script needs the extension's `node_modules` (`bun install`).
