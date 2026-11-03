# Changelog

## [0.15.36-pi.10] - 2026-11-03

- Resume and fork a descendant that a worktree worker started inside its worktree, from the root chat, while keeping unrelated-directory records refused.
- Recover a steering message stranded at settlement with its recorded images and its own message boundary instead of joining text and dropping attachments.
- Refuse a new subscription event with HTTP 503 and `Retry-After` when 20 events are undelivered, instead of evicting an event the sender was told was accepted.
- Keep accepted `new_session` work eligible after the subscription expires; expiry only stops new occurrences.
- Run a `new_session` timer on the model, thinking level, and project-trust decision it was created with, live or detached.
- Append Task settle-time notices to entries another extension proposed at the same boundary.
- Signal a pre-epoch supervisor lock only when its command line identifies this supervisor, so a reused pid cannot target an unrelated process.
- Report durable subscriptions and detached supervision in the host section instead of saying they live only in the current Pi process.

## [0.15.36-pi.9] - 2026-11-03

- Follow the repository Vitest rules in the test suite. No runtime change.
- Correct stale documentation against the current code, including versions, counts, paths and host requirements.

## [0.15.36-pi.8] - 2026-11-02

- Declare `cost.totalFromProvider` on the exported `Usage` type so the package typechecks again, completing the provider-reported cost provenance aggregation shipped in 0.15.36-pi.7.

## [0.15.36-pi.7] - 2026-11-02

- Update the host compatibility documentation for Pi 1.5.0. Retain the four native gaps for RPC process control, skill-block formatting, named-ID fork truncation, and workspace folder naming.
- Keep earlier verification records unchanged. This documentation audit does not claim new runtime-test results or complete upstream parity.
- Preserve string-enum argument shapes and optional literal types with TypeBox schemas under Pi 1.5.0 validation.
- Preserve provider-reported cost provenance when aggregating subagent usage.
- Ship a versioned package-root changelog entry for Pi 1.5.0's extension update notices.

## [0.15.36-pi.6]

- Implement version-2 durable subscription registry with transactional file locking, native owner continuation delivery via `pi.sendMessage`, bounded exponential retry on detached failures, per-subscription queue caps, non-blocking GitHub arming, legacy supervisor termination, and in-process fallback isolation.
- Decode child RPC stdout streams using `StringDecoder` to preserve split multibyte UTF-8 code points across buffer boundaries.
- Publish upstream pstack git commit provenance in `pstackSource` and exclude nested script dependencies from npm publication archives via `skills/.npmignore`.
- Canonicalize statechart symlink test fixture paths on macOS and add checksum-verified TLC statechart verification to CI.

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
