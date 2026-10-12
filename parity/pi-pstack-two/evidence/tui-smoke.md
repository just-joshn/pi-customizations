# Interactive (TUI) smoke run

Date: 2026-10-12, against the 0.15.20 sync. The user's installed `pi` launcher (`~/.pi/agent/bin/pi`, managed release 1.1.0) ran in tmux 3.8 at 160x45. Isolated agent directory `/tmp/pp2-tui/agent` with `HOME=/tmp/pp2-tui`, `PI_OFFLINE=1`, session directory `/tmp/pp2-tui/sessions`. The package was installed through a symlink (`packages: ["/tmp/pp2-tui/pkglink"]`, a link to `extensions/pi-pstack-two`) to exercise the recheck-1 fix. The scripted test model (`test/fixtures/scripted-model.ts`) and three prompt templates (`/todo-demo`, `/ask-demo`, `/bg-demo`) each script one tool call. The model is deterministic, so this run checks host behavior, not model judgment.

| Step | Input | Observed on screen | Requirement |
|---|---|---|---|
| 1 | Type `/poteto` | Menu: `→ poteto-help`, `poteto-mode` with their skill descriptions, then Pi's `skill:poteto-help`, `skill:poteto-mode`, … `(1/7)` | CMD-003 (symlinked install) |
| 2 | Tab | Editor completed to `/poteto-help` | CMD-003 |
| 3 | `/mode poteto-mode` | Notification `Custom Mode on: poteto-mode. /mode off exits.`; footer line `mode: poteto-mode` | MODE-001, MODE-005 |
| 4 | `/how @@say TUI-ALIAS-OK` | Pi's native `[skill] how (ctrl+o to expand)` block, the argument line, reply `TUI-ALIAS-OK`; context 16.2% (mode body plus skill) | CMD-001 (symlinked install) |
| 5 | `/todo-demo` | Tool result `Todos (1/3 completed, 1 in progress)`; widget above the editor `Todos 1/3`, `✓ Frame the work`, `▶ Build it`, `○ Verify it` | TODO-001, TODO-002 |
| 6 | `/ask-demo`, Down, Enter | Dialog `Which budget?` with `→ Small`, `Large`; after picking, the tool result `budget: large (Large)` | HOST-005 (port side) |
| 7 | `/reload`, then `/how @@say AFTER-RELOAD` | `Reloaded keybindings, extensions, skills, prompts, themes, and context files`; the alias still expanded; reply `AFTER-RELOAD`; widget and `mode: poteto-mode` footer rebuilt from the branch | PKG-002, MODE-003, TODO-002 |
| 8 | Type `/ketc` after the reload | Menu `→ ketchup` first, then `skill:ketchup` | CMD-003 after reload |
| 9 | `/bg-demo` (background `Task`, child sleeps 2.5 s) | Launch result at once (`Subagent is running in the background…`, `Agent ID: f0e95e0c-…`); about 3 s later a `<task>` notification (`status: success`, `detail: BG-DONE`) started a turn and the model replied to it | TASK-003 |
| 10 | `/mode off` | Footer `mode:` line gone | MODE-002, MODE-005 |
| 11 | `/quit` | Process exited. The session file holds mode entries `["poteto-mode", null]`, one `pstack-two/task` notification, and one `TodoWrite` result | MODE-003 |

An earlier run (prior session, older code) found that Pi's template expansion dropped a loop footer appended to the prompt text; loop state moved to a `pstack_loop` system-prompt section, covered by `test/loop.test.ts`.
