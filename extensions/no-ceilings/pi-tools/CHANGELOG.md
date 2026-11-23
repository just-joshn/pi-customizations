# Changelog

## 0.1.0

- Initial release of the Pi-native local tool-execution layer.
- Filesystem tools: `read`, `ls`, `find`, `grep`, `write`, `edit`, `apply_patch`, `delete`, overriding
  the Pi built-ins of the same names where one exists.
- Execution and auxiliary tools: `bash` (working directory, environment overrides, timeout, streamed
  output, exit status), `git`, `web_fetch`, `web_search`, `save_resource`.
- Permission policy with `unrestricted`, `auto`, and `allowlist` modes, read/write/exec rules, and
  approval prompts through `ctx.ui.confirm`.
- Ignore handling for `.gitignore`, `.ignore`, and `.piignore` across search, listing, and glob.
- Read fences for stale-write detection, post-write digest verification, case-folding collision
  refusal, and binary-file refusal.
- Content search with result limits, output caps, line truncation, and partial results on timeout.
- `search_tools` for tool-schema discovery and dynamic activation of the auxiliary tools.
