# Standalone skills

Standalone skills in `skills/` provide modular workflows (doctor, simplify, run, reverse-engineer-cli, implement-cli-from-contract) loaded via Pi package declaration without requiring extensions.

## Sub-features

- `skills-declaration` declares root skill directory in `package.json`.
- `skills-registration` exposes `/skill:<name>` commands in the Pi CLI and RPC interface.
- `skills-execution` enables invocations without model overhead for skill definition loading.

## How to get to it (user POV)

- Type `/skill:doctor` in Pi interactive chat.
- Type `/skill:implement-cli-from-contract` in Pi interactive chat.
- Type `/skill:reverse-engineer-cli` in Pi interactive chat.
- Type `/skill:run` in Pi interactive chat.
- Type `/skill:simplify` in Pi interactive chat.
- Query `get_commands` over Pi RPC.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- Root `package.json` declares `"pi": { "skills": ["./skills"] }`.
- Disposable `PI_CODING_AGENT_DIR` scratch directory initialized.

- **Query registered commands.** Send `{"type": "get_commands"}` to the RPC session loading the root repository. Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive standalone-skills`.
- **Verify skill availability.** Filter returned commands for `source: "skill"` and ensure `skill:doctor`, `skill:implement-cli-from-contract`, `skill:reverse-engineer-cli`, `skill:run`, and `skill:simplify` are all registered.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/standalone-skills/skills.txt` and `skills.json`.

## Gotchas

- Standalone skills do not require `extensions/` to be loaded; they are registered natively by Pi's skill loader.
- Native skills are prefixed with `skill:` in Pi's command list.
- Modifying a skill's `SKILL.md` frontmatter changes its registration name and description.
