---
name: run
description: "Launch and drive this project's app to see a change working in the real app, not just the tests. Use when asked to run, start, launch, try, or screenshot the app, or to confirm a change works end to end. First looks for a project run skill that already covers launching the app, otherwise falls back to bundled recipes per project type (CLI, server, TUI, Electron, browser-driven web app, library). Use when the user runs /skill:run."
license: MIT
---

# Run the app

**Running means launching the actual app and interacting with it**,
not the test suite, not an `import` of an internal function and a
`console.log`. Meet the app the way a user (human or programmatic)
would: the CLI at its command, the server at its socket, the GUI at its
window.

## First: does a project skill already cover this?

A project skill that launches this app is the repo's verified path. Its
author already cold-started the app and committed what worked: the
exact install line, the env vars, the patches, the driver. Use it
instead of rediscovering. Check the skills Pi already listed in your
system prompt, then search the repo for skills Pi may not load (other
harnesses' directories, nested packages):

```bash
d=$PWD; while :; do
  grep -Hm1 '^description:' "$d"/{.pi,.agents,.claude}/skills/*/SKILL.md 2>/dev/null
  [ -e "$d/.git" ] || [ "$d" = / ] && break
  d=$(dirname "$d")
done
find . \( -name node_modules -o -name .git \) -prune -o \( -path '*/.pi/skills/*/SKILL.md' \
  -o -path '*/.agents/skills/*/SKILL.md' -o -path '*/.claude/skills/*/SKILL.md' \) \
  -exec grep -Hm1 '^description:' {} + 2>/dev/null
```

Pi loads `.pi/skills` only from its working directory and `.agents/skills`
from the working directory upward, so a nested package's skill loads only
when Pi starts in that package. Read a match here directly.

- **One describes launching or driving this app.** Read that SKILL.md
  and follow it verbatim. Don't paraphrase, and don't skip the patches.
- **Mega-repo, several plausible, no clear match.** Ask the user which
  unit to run.
- **Stale** (fails on mechanics unrelated to your task). Tell the user,
  and offer to rewrite its SKILL.md in Pi's skill format (Pi's
  `docs/skills.md`).
- **Nothing about running.** Fall back to the patterns below.

## Otherwise: match the shape, use the pattern

Pick the row closest to your project. Each example walks through
launch and first interaction. Ignore any trailing "write the skill"
section. You're using the recipe, not authoring one.

| Project type | Handle | Example |
|---|---|---|
| CLI tool | direct invocation, exit code, stdin/stdout | [examples/cli.md](examples/cli.md) |
| Web server / API | background launch + `curl` smoke | [examples/server.md](examples/server.md) |
| TUI / interactive terminal | tmux `send-keys` / `capture-pane` | [examples/tui.md](examples/tui.md) |
| Electron / desktop GUI | Playwright `_electron` REPL driver (xvfb on headless Linux) | [examples/electron.md](examples/electron.md) |
| Browser-driven | dev server + `playwright-cli` | [examples/playwright.md](examples/playwright.md) |
| Library / SDK | import-and-call smoke script at the package boundary | [examples/library.md](examples/library.md) |

If nothing fits, start from the closest match and adapt. For a web app,
use [examples/playwright.md](examples/playwright.md) and drive it with
`playwright-cli`, no custom driver needed. For a desktop app, use
[examples/electron.md](examples/electron.md). It has the `_electron`
REPL driver skeleton and the tmux wrapping.

Long-running processes (servers, dev servers, TUIs) go in the
background or in tmux, never in a blocking foreground command.

## Drive it, don't just launch it

Launching with no interaction proves the entrypoint resolves. That's
not running the app, it's typechecking with extra steps. Drive it to a
point where a user would see something:

- CLI: type a representative command, check the exit code and output.
- Server: hit the route the diff touches with `curl`, read the body.
- TUI: `send-keys` a navigation, `capture-pane` the result.
- GUI: click the button, screenshot the window. **Look at the
  screenshot** with the read tool. A blank frame is a failure to launch.

Stop every process you started before you finish.

## Report

Say what you ran, what you saw (output, response body, pane capture, or
screenshot path), and whether the change behaved as intended.

If the fallback pattern didn't work out of the box (you had to install
packages, set env vars, patch config, or write a driver), recommend
capturing that work as a project `run-<unit>` skill. Write it to
`.pi/skills/run-<unit>/SKILL.md` in Pi's skill format (Pi's
`docs/skills.md`), using the matching example's "write the skill"
section as the outline. If it just worked, don't.
