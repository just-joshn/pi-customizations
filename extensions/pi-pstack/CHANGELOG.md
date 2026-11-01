# Changelog

## [0.15.36-pi.5]

- Replace hand-rolled frontmatter, attachment MIME, and session header parsers with Pi 1.4.0 exports (`stripFrontmatter`, `detectSupportedImageMimeTypeFromFile`, and `parseSessionEntries`).
- Register TUI message renderers for `pstack/task` and `pstack/subscription`, drain parked `runtime/inbox/` wakes on session restore, surface durable delivery state in `list_subscriptions`, and report live supervisor status in `/routines`.
- Declare published `files` in `package.json`, record the REA architecture reconstruction report in `docs/parity-reverse-engineering.md`, and enforce zero dependencies on an external `pstack` checkout.

## [0.15.36-pi.4]

- Add a durable routines supervisor (`pstack-routines-supervisor`) that dual-writes subscription desired state and auto-starts on `subscribe_*` so timers and webhook routines keep firing after the interactive chat exits. Optional launchd/systemd examples live under `packaging/`.
- Add `packaging/install-supervisor-unit.sh` for opt-in reboot survival (idempotent launchd or systemd user unit). Benny setup and the overnight guide point at it.
- Teach `/ketchup-video` and the host media section to open the rendered mp4 in the system player, read one frame per slide, and name the path (Pi chat does not inline-play video).
- Expand the vendored `create-skill` soft-dep to full interview and structure depth with Pi paths.

## [0.15.36-pi.3]

- Vendor the full soft-dependency team-kit skill and agent set into the package (CI, PR, review, verification, weekly summary, and the two engineering rules as skills), so pi-pstack no longer needs a separate team-kit install for parity.
- Inject the two former always-apply engineering rules into the host system prompt, and teach the thermo-nuclear agent to gather diffs with Pi tools instead of inventing `shell` / `explore` Task types.
- Keep Claude Code harness notes out of the package (Pi users get `docs/native-gaps.md` instead).

## [0.15.36-pi.2]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
