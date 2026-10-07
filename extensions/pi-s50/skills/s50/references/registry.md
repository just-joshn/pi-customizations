# Registry

S50 skills are locked to the skills.sh all-time top 50 in `.s50/registry.lock.json`.

- `s50 registry refresh [--sources <sources.json>]`: fetch https://skills.sh/ (all-time view) and lock. Network access. Without `--sources` it uses the package's inspected `registry/skill-sources.json`.
- `s50 registry refresh --from <leaderboard.json> [--sources <sources.json>]`: lock from a captured leaderboard.
- `s50 registry show`: one line per skill: `<rank> <source>/<name> <invocationPolicy>`.
- `s50 registry verify`: checks every skill rank is <= 50 and matches its leaderboard entry.

Refresh fails closed (exit 2) when a required skill is ranked above 50 or absent.

Invocation policy: `model` skills may be invoked through `{"kind":"invoke_skill","skill":"<name>"}`. `user` skills (`disable-model-invocation: true`) are rejected with a `user_workflow` gate; tell the user to run `/skill:<name>`. A skill that is not installed blocks with a `missing_skill` gate and its `npx skills add <source> --skill <name>` command.
