# Mapping review brief

User goal: a Pi 1.5.2 theme extension that reproduces Claude Code 2.1.322's built-in `dark` theme, built verbatim from the design pack at `/Users/josh-desktop/Documents/pi-claude-default-design-pack/DESIGN.md`. Read §1 ("Meaning of parity"), §4 (domain model and invariants), §7 (crosswalk and its caveats), and §8.3 before starting. The rule that matters most: no color reaches the theme unless a real capture proves it. A guess, an interpolation, or a name match is not evidence.

Your job: for each of the 56 Pi theme roles, decide how it maps to Claude Code, using the captures as the only source of colors.

## Evidence (all under `extensions/pi-claude-default-dark/development/`)

- `captures/claude/<scene>.ansi` shows Claude Code 2.1.322 `dark`. `captures/pi-dark/<scene>.ansi` shows stock Pi dark. `captures/pi-role-probe/<scene>.ansi` shows Pi with a probe theme where every role has a unique color. `captures/role-probe.map.json` maps those probe colors back to role names. Each `run.json` lists the scenes and marks Pi-only scenes as `pi-only`. Captures are `tmux capture-pane -e` dumps with 24-bit SGR.
- `captures/terminal-palette.json` holds the measured terminal palette (Alacritty, background #181818, foreground #d8d8d8, ANSI16). Claude sometimes emits ANSI16 codes (30–37, 90–97) or SGR 39 (the terminal default). Pi themes can express both: an integer 0–255 gives a palette index, and `""` gives the terminal default. Keep an ANSI or default value as that kind (`ansi:4`, `default`) and do not resolve it to hex, because an exact match must emit the same kind.
- `lib/sgr.ts` (`parseCapture`) and `lib/align.ts` (`screen`, `resolve`, `sceneRows`) are parsers you can import from a scratch `.ts` file run with `node file.ts`. Do not edit them.
- `crosswalk.csv` is the automatic first pass. For each probe-colored Pi token it finds the same text in the Claude capture of the same scene. Treat its classes as unreliable hints, especially `renderer-required`, because long transcripts repeat tokens. `captures/observations.json` holds the raw matches (large, so query it with `jq` or a script).
- `captures/pi-role-probe/coverage.txt` lists the scenes where each role appears.
- The Pi 1.5.2 source is at `/Users/josh-desktop/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist`. Use it to learn which surface a role paints.

## Decide for each role

One of:

- `measured`: one Claude surface corresponds to this role's Pi surface. Every capture of that surface shows the same color and attributes. Give the value (`#rrggbb`, `ansi:N`, or `default`), the attributes, and at least one pointer `scene@row:col` into `captures/claude/` where you read it.
- `renderer-required`: Claude uses different values on surfaces that Pi paints with this one role. A theme cannot express that, and only a renderer hook could. List each Claude context with its value and pointer.
- `unmappable`: Claude has an analogous surface, but its styling cannot be reproduced through this role at all, for example because the direction or structure differs (Claude paints a background where Pi paints a foreground). Explain why.
- `pi-only`: Claude has no analogous user-visible state. Name the Pi surface. Per the pack, this does not count toward parity.

Also list **Claude-only surfaces**. These are distinct Claude styles in comparable scenes that no Pi role covers, for example diff line backgrounds or the `⏺` bullet. For each one, name the scene, pointer, value, and the closest Pi surface. The pack counts an uncovered comparable surface as a blocker, so be exhaustive across `captures/claude/*.ansi`.

Check every `measured` claim yourself by reading the raw cells with the parser. Do not copy the CSV. When the Pi surface and the Claude surface are not clearly the same thing, say so and do not call it `measured`.

## Output

Write `mapping-review/<your-model-family>.json` (`claude.json` or `gpt.json`) with this shape:

```json
{ "roles": { "<role>": { "class": "...", "value": "...", "attrs": "...", "evidence": ["scene@row:col"], "piSurface": "...", "claudeSurface": "...", "note": "..." } },
  "claudeOnly": [ { "scene": "...", "at": "row:col", "value": "...", "attrs": "...", "surface": "...", "closestPi": "..." } ] }
```

The file must have all 56 roles. Do not edit any file outside `mapping-review/`. Do not commit. Your final message should give the counts per class, the 5 decisions you are least sure of, and the path of the file you wrote.
