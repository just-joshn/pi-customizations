---
name: caveman-stats
description: >
  Show recorded output and cache-read token usage and mode attribution for
  the current Pi session. Trigger: /caveman-stats.
---

In Pi, `/caveman-stats` is an extension command. It reads the usage Pi recorded on every assistant message in the active session branch, attributes output tokens to the caveman mode that was active when each message was generated, appends one row to the lifetime history at `~/.pi/agent/caveman/history.jsonl`, and posts the report into the session as a fenced code block. Never calculate, recompute or re-round the numbers yourself.

Options: `--share` prints a one-line summary. `--all` aggregates the lifetime history. `--since 7d` or `--since 24h` limits that history to a window.

Savings remain unknown without a measured comparison. Never estimate saved tokens, percentages or dollars.
