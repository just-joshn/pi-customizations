# Changelog

## 0.1.0

- First release. Registers the **Antigravity CLI (Experimental)** provider, which
  serves Antigravity models to Pi by driving `agy acp --stdio` over the Agent
  Client Protocol.
- Every CLI tool request is rejected and replayed as the matching Pi tool, so the
  CLI never runs a command or edits a file. A tool the CLI would run without
  asking for permission ends the turn too, and one with no Pi equivalent is
  reported as an error instead of being dropped.
- `run_command` aimed at a directory other than Pi's is refused rather than run
  in the wrong place, and `sed_file` is left unmapped because its semantics do
  not collapse onto one old/new pair.
- Model discovery reads the CLI's own catalog and collapses its per-effort model
  ids onto one Pi model per family, mapped onto the CLI's `thought_level` option.
- Account blocks arrive as assistant text, not protocol errors, so they are
  rewritten into non-retryable errors that say what happened.
- `/antigravity-status` reports the CLI version, plan, and model count.
