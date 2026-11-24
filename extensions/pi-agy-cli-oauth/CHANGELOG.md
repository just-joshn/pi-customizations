# Changelog

## 0.1.0

- First release. Registers the **Antigravity CLI (Experimental)** provider, which
  serves Antigravity models to Pi by driving `agy acp --stdio` over the Agent
  Client Protocol.
- Every CLI tool request is rejected and replayed as the matching Pi tool, so the
  CLI never runs a command or edits a file.
- Model discovery reads the CLI's own catalog and collapses its per-effort model
  ids onto one Pi model per family, mapped onto the CLI's `thought_level` option.
- Account blocks arrive as assistant text, not protocol errors, so they are
  rewritten into non-retryable errors that say what happened.
- `/antigravity-status` reports the CLI version, plan, and model count.
