# How: plugin skills/agents registration (lock ccb5507)

Source investigation: agent 115f76b1-6750-4825-8ae7-f4695c98dc3c (read-only how).

## Cursor
- Manifest: `parity/reference/cursor-plugins/pstack/.cursor-plugin/plugin.json`
- Digest: `sha256:7bc736c60985805f70465e044e5adc7028663f72a73deea7fa3e95e52d70dc8e`
- Keys: `"skills": "./skills/"`, `"agents": "./agents/"`
- Load: `cursor-agent --plugin-dir <pstack-root>`

## Pi (honest delta)
- Skills: `extensions/pi-pstack/package.json` → `"pi"."skills": ["./skills", "./host/skills"]` via `readPiManifest` (no agents key).
- Agents: `extensions/pi-pstack/src/persona-agents.ts` loads `upstream/agents/*.md` into Task personas — not Cursor `plugin.json`.

## Capture note
Do not treat other skill journeys as closing `PSTACK-CMD-PLUGIN-SKILLS-REGISTER-001`. Dedicated pair must observe registration surfaces (slash/status/agent types) with this delta recorded.
