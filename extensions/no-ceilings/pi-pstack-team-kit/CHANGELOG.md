# Changelog

## 0.1.1

### Added

- Add the Pi-native pstack + cursor-team-kit skills package with 34 pstack operational skills, 24 principles, 22 poteto-mode playbooks, 18 team-kit skills, 4 agents, and 2 engineering rules.
- Bundle Pi ports of `/skill:loop`, `/skill:create-skill`, `/skill:automate`, and `/skill:goal`. Automation and webhook flows require a configured provider.
- Register skills via `pi.skills` for `pi install`, ship agents under `agents/`, and document package-relative skill resolution for install roots.
- Add `scripts/verify-inventory.mjs` inventory presence and portable frontmatter checks, and fail when a skill calls a tool no documented companion package provides.
- Document `@justjoshn/pi-subagents` and `@justjoshn/pi-modes` as companion packages that supply `task`, `await_subagent`, `ask_question`, and `switch_mode`.
