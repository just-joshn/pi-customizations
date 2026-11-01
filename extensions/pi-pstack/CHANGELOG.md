# Changelog

## [0.15.36-pi.4]

- Add a durable routines supervisor (`pstack-routines-supervisor`) that dual-writes subscription desired state and auto-starts on `subscribe_*` so timers and webhook routines keep firing after the interactive chat exits. Optional launchd/systemd examples live under `packaging/`.
- Expand the vendored `create-skill` soft-dep to full interview and structure depth with Pi paths.

## [0.15.36-pi.3]

- Vendor the full soft-dependency team-kit skill and agent set into the package (CI, PR, review, verification, weekly summary, and the two engineering rules as skills), so pi-pstack no longer needs a separate team-kit install for parity.
- Inject the two former always-apply engineering rules into the host system prompt, and teach the thermo-nuclear agent to gather diffs with Pi tools instead of inventing `shell` / `explore` Task types.
- Keep Claude Code harness notes out of the package (Pi users get `docs/native-gaps.md` instead).

## [0.15.36-pi.2]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
