# Example: Browser-driven web app

You have a dev server that serves HTML to a browser. An agent can't look
at a browser window, so "run the app" means launching the dev server,
driving a headless Chromium against it, and producing a snapshot or
screenshot that proves the page rendered.

Don't write a browser driver. Use `playwright-cli`.

## Dev server

Find the dev command (`package.json` `scripts.dev`, `Makefile`,
README), start it in the background, and wait for it to actually serve:

```bash
npm run dev &> /tmp/dev.log &   # or yarn dev, pnpm dev, make serve, ./dev.sh
timeout 30 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'
```

Don't `sleep 5` - poll the port. Stop by killing the port's listener
-- `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill` - before relaunching,
or the next run hits `EADDRINUSE`. (`$!` after `npm run dev &` is only
the npm wrapper; npm doesn't forward SIGTERM to the server it spawned,
so the port kill is what actually frees it.) Avoid `pkill -f` with a
broad pattern - it can match the agent's own command line and kill the
session.

## Drive

`playwright-cli` keeps a headless browser alive between commands. If it
isn't on `PATH`, use `npx playwright cli` when the project has
Playwright, or install it with `npm install -g @playwright/cli@latest`.

```bash
playwright-cli -s=app open http://localhost:3000
playwright-cli -s=app snapshot          # accessibility tree with element refs (e1, e2, ...)
playwright-cli -s=app find "New item"   # locate the ref you need
playwright-cli -s=app click e12
playwright-cli -s=app fill e15 "Smoke test" --submit
playwright-cli -s=app find "Smoke test"
playwright-cli -s=app screenshot
playwright-cli -s=app console
playwright-cli -s=app close
```

That's the whole loop: `open` -> `snapshot` / `find` the element you
need -> act (`click` / `fill` / `type` / `press`) -> confirm with
`find` or `snapshot` -> `screenshot` -> `console` to check nothing
threw. Refs change when the page changes, so re-`snapshot` after each
navigation. Full command reference: `playwright-cli --help`.

**If `playwright-cli` can't be installed:** adapt
[electron.md](electron.md)'s REPL driver - the structure and commands
transfer, but it's `_electron`-specific:
import `{ chromium }` instead, launch with
`chromium.launch({ args: ['--no-sandbox'] })`, acquire the page via
`(await app.newContext()).newPage()` then `goto()` your dev URL, and
drop the Electron-only window introspection
(`.windows()`/`.firstWindow()`/the `windows` command).

## What to put in the skill

The project-specific bits only. `playwright-cli` handles the mechanics.

- **Dev command + port + stop.** The exact start line, any env vars it
  needs, and the `kill` to stop it.
- **Auth.** Whatever gets a logged-in session - a `cookie-set` line, a
  `fill`/`click` login sequence, or a helper script that does the API
  dance and emits the cookie.
- **One representative interaction.** Not the whole app - one path that
  proves it's running, ending in a screenshot.
- **App-specific gotchas.** Only the ones you actually hit.

## Gotchas that recur

- **React controlled inputs.** `eval "el => el.value = '...'"` doesn't
  fire React's onChange. Use `fill` / `type` - they go through
  Playwright's input pipeline.
- **Websockets / long-poll.** Waiting for the network to go idle never
  settles. Poll with `find` for the element you actually need.
- **Slow first paint.** Vite/Next compile routes on demand; the first
  `open` can take 10s+. Retry `find` instead of a raw `sleep`.
- **Element screenshots.** `screenshot e12` crops to one element - use it
  when the diff is in a specific component, not the whole page.
- **Check `console` before declaring success.** A page can render
  its shell while every data fetch 500s.
