# Respect the user's choice

The package never switches the theme on its own: its startup hooks only restyle the working indicator, and only when `claude-default-dark` is already active. Of the package's own paths, only an explicit `/claude-theme use` changes the theme. A user whose settings say `dark` keeps `dark` when Pi starts with the package installed and after `/reload`, and `/claude-theme` keeps working after reloads.

## Sub-features

- `startup`: with `settings.json` `theme: dark`, the first screen has no theme `muted` SGR.
- `reload`: after three `/reload` runs the theme is still `dark` and `settings.json` still says `dark`.
- `command-after-reload`: `/claude-theme status` after the reloads still gives the installed message.

## How to get to it (user POV)

- Keep a theme of your own in `/settings`, install the package, restart Pi, and run `/reload`.

## Driving it with control-claude-default-dark

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark drive respect`.
- **Act.** Install, write `theme: dark`, start the TUI. Three times: type `/claude-theme status`, then `/reload`, and wait until Pi's `Reloaded keybindings, extensions, …` message has replaced the status message, which proves that reload finished. Then `/claude-theme status` once more.
- **Observe.** No theme `muted` SGR at startup or on the screen after the third reload; the installed message; `settings.json` `theme` is `dark`.
- **Proof.** `artifacts/verify-pi-claude-default-dark/respect/after-reloads.ansi`.

## Gotchas

- Pi has no `/clear` command; typed into the editor it becomes a prompt and, with no model, an error.
- Duplicate registration of `/claude-theme` is not observable from the TUI: Pi shows only the latest notification, and its autocomplete lists one `claude-theme` row even when an extension registers the command twice.
- This proves the shipped extension has no startup or reload theme override. The package's static scan allows only the `session_start`, `agent_start`, and `turn_start` handlers and rejects `setTheme` outside a command, so a regression here usually means that scan was weakened too.
