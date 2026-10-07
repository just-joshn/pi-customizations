# Registry

- `s50 registry refresh`: confirms skills.sh still ranks by install telemetry, fetches the all-time leaderboard, resolves each S50 skill at its repository's current `HEAD`, and hashes its SKILL.md. Needs network access to skills.sh and GitHub.
- `s50 registry refresh --from <leaderboard.json> [--sources <sources.json>]`: locks from a captured leaderboard and pinned sources, with no network. The default sources file is the package's `registry/skill-sources.json`.
- `s50 registry show`: prints the snapshot time, then each locked skill with rank, source, invocation policy, and commit.
- `s50 registry verify`: checks every locked skill ranks 50 or better and matches its leaderboard entry.

When a required skill is missing from the top 50 or its source does not match the leaderboard, the refresh writes a rejected lock and exits 2, and no new run starts until a refresh succeeds. An optional skill that drops out is left out of the new lock. An active run keeps the snapshot it started with.
