# Runtime observation, and where this port stops

Runtime evidence is the only evidence that can support a claim about what a program *does*. This
port produces none of it: it has no browser, Electron, process, native-UI or instrumentation
capture, and it executes nothing — not the target, not its scripts, not a helper.

That boundary is a property of the port, not of the question. Keep it visible.

## What each runtime question needs

| Question | What would answer it | Available here? |
| --- | --- | --- |
| Which handler runs when the renderer sends this channel? | A live Electron or browser observation of the running app | No |
| What does this function do at runtime? | Provider decompilation plus a debugger or instrumentation | No |
| What traffic does the app send? | A recorded capture (HAR) or a live proxy | Only a retained HAR: `inspect-web-network-capture` |
| What files does it write, and in what order? | A bounded process capture with declared inputs and stopping conditions | No |
| What does the window look like? | A screenshot or native-UI observation | No |

## What to do instead

1. Answer what static evidence can answer, and say which parts are static. The JavaScript graph
   answers containment and candidate relationships even when it cannot answer reachability.
2. Name the specific runtime evidence the remaining question needs, and record it:
   ```bash
   node scripts/rea.mjs record-unknown --question "Does the search handler read from the native index at runtime?" \
     --severity high --domain ipc --required-authority runtime-observation \
     --required-confidence exact --recommended-probe "observe one invoke of notes:search in a running app" --json
   ```
   `--required-authority runtime-observation` makes the gap explicit: no static record can close it.
3. If the user can supply a recorded artifact — a HAR file, a package, a core dump — inspect that
   instead. A recording is evidence about the run that produced it; it is not live traffic, and
   saying "recorded" rather than "observed" is part of the claim.
4. Never upgrade a static candidate into a runtime statement because it looks obvious. "The renderer
   invokes `notes:search` and a main handler is registered for it" is supportable. "The app searches
   the notes database when you type" is not.

## Wording

Static evidence supports: *is declared*, *is registered*, *is requested*, *is referenced*, *is
contained in*, *is a candidate for*.

Static evidence does not support: *runs*, *executes*, *is called*, *is reachable*, *happened*,
*is enabled* — unless a runtime record in the same session cites the executed target.
