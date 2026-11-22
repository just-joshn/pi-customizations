# Changelog

## 0.1.1

### Added

- Add the Pi-native pstack + cursor-team-kit skills package with 34 pstack operational skills, 24 principles, 22 poteto-mode playbooks, 18 team-kit skills, 4 agents, and 2 engineering rules.
- Bundle Pi ports of `/skill:loop`, `/skill:create-skill`, `/skill:automate`, and `/skill:goal`. Automation and webhook flows require a configured provider.
- Register skills via `pi.skills` for `pi install`, ship agents under `agents/`, and document package-relative skill resolution for install roots.
- Add `scripts/verify-inventory.mjs` inventory presence and portable frontmatter checks, and fail when a skill calls a tool no documented companion package provides.
- Document `@justjoshn/pi-subagents` and `@justjoshn/pi-modes` as companion packages that supply `task`, `await_subagent`, `ask_question`, and `switch_mode`.

### Fixed

- `task` accepts a `thinking` level and passes it to the child session. Role values are split into a bare model id and an effort token, so the setup-pstack budget changes the child's reasoning level instead of collapsing to one model.
- Session-directory overrides set by `sessionDir` or `--session-dir` are treated as flat directories in `workflow-from-chats`, `recall`, `reflect`, `eval`, and `session-pickup`. `worktree-audit.sh` reads the setting and accepts `-s`.
- Add `scripts/purge-shadowed-skills.mjs` and the install step that archives older local copies. A user or project copy wins over the package and would otherwise freeze the old text.
- Correct `poteto-help` skill discovery. It now lists `.pi/skills` and `${PI_CODING_AGENT_DIR}/skills`, and names the skills that load without `disable-model-invocation`.
- `pr-review-canvas` assembly reads `styles.css`, `renderer.js`, and `template.html` from the skill directory instead of the agent cwd.
- Restore `model: claude-opus-5-5` on `poteto-agent` and `model: fast` on `ci-watcher`, with parent-model fallback when a model is absent.
- Keep the effort token when `setup-pstack` validates a role against the detected model set, so `medium` and `small` write different rules.
- Split the `arena cross-judge pool` value before dispatch, so the judge runs on another vendor instead of falling back to the parent.
- Honor a trusted project `sessionDir` over the user setting, resolve relative values from the working directory, and tell `worktree-cleanup` to pass `-s` when Pi runs with `--session-dir`.
- List all 20 auto-loadable skills in `poteto-help`, including `create-skill`, and exclude the two team-kit skills that set `disable-model-invocation`.
- Fail a task with a clear error when an explicit model id is not registered, instead of silently using the parent model. An invalid agent default still falls back. Pass `provider/id` when a bare id is ambiguous across providers.
