# Custom modes

A Pi skill becomes a persistent mode. The entered turn carries the whole skill block, later turns carry a sticky reminder, `/mode off` leaves it, and `/mode color` or `/mode icon` writes validated frontmatter without damaging the skill body. Single-file skills and one-message skill attachment are separate entry points.

## Sub-features

- `custom-entered`: `--mode=reviewer` sends the entered instruction and real `<skill>` block.
- `custom-sticky`: a later turn carries the reminder, not a second copy of the body.
- `custom-exit`: `/mode off` sends the exit notice once and stops the reminder.
- `custom-appearance`: `/mode color` and `/mode icon` write validated frontmatter and preserve the body.
- `one-message-skill`: mentioning `/reviewer` attaches the skill to that message only.
- `custom-resume`: resuming the session keeps the reminder and does not add another unchanged state snapshot.

## How to get to it (user POV)

Put a skill at `.pi/skills/<name>/SKILL.md` or `.pi/skills/<name>.md` with frontmatter `name` and `description`. Enter it with `--mode=<skill>` or `/mode <skill>`. Ask a question, then ask another after the mode is active. Change its appearance with `/mode color <name>` or `/mode icon <glyph>`. Mention `/<skill>` in one prompt to attach it for that message only.

## Driving it with the fake-model harness

```sh
node "$HELPER" drive "$EVIDENCE"
```

Require these exact `ok` lines in `stdout.log`:

- `ok custom run sends the entered instruction`
- `ok custom run attaches the real skill body`
- `ok custom run attaches the skill block`
- `ok the later turn carries the reminder`
- `ok the later turn does not repeat the skill body`
- `ok /mode off states the exit once and stops the reminder`
- `ok /mode color and /mode icon write validated frontmatter and keep the body`
- `ok an exact title wins over the appearance verb and loads the single-file skill`
- `ok appearance edits replace a folded value without damaging the skill`
- `ok the reminder names the single-file skill`
- `ok /reviewer attaches the skill to that message only`
- `ok the selected custom mode has a session file`
- `ok the resumed custom mode still sends its reminder`
- `ok resuming does not append an unchanged snapshot`

Inspect `e2e-root/workspace/.pi/skills/reviewer/SKILL.md` and the single-file palette skill. Require the body marker to survive, the accepted color and icon to be present, and the rejected color to be absent. The session directory under `e2e-root/sessions/` holds the JSONL state snapshots.

## Gotchas

- The fake e2e's skill fixtures are verification scaffolding, not installed modes. Do not copy them into the user's profile.
- Appearance writes normalize flow-style maps, preserve BOM/CRLF, and reject unknown colors; preserve the body and do not accept a file that only parses.
- A mode entered with `--mode=<skill>` is not the same as `/skill:<name>` one-message attachment. Verify both when the change touches skill loading.
- The mode reminder is a sticky instruction, not a repeated skill body. A later turn containing the full body is a failure.
- Resume must not append an unchanged `pi-modes-state` snapshot. Compare snapshot counts before and after.
