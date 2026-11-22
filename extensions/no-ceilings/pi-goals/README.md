# `@justjoshn/pi-goals`

Pi-native Long-Lived Goals (`/goal`) for [Pi](https://pi.dev) (part of the `no-ceilings` package suite).

Pursue objectives beyond a single turn, track active duration live, continue while idle until complete or the `--goal-max-idle` cap, and pause cleanly on a user interrupt.

## Commands

- `/goal <objective>` — Start a durable goal that continues while idle
- `/goal status` — Show the current goal status, objective, continuations, and active duration
- `/goal pause` — Pause the active goal and freeze active duration
- `/goal resume` — Resume a paused goal and dispatch a continuation turn
- `/goal complete` — Mark the current goal complete
- `/goal clear` — Clear the current goal

## Tools Registered

- `create_goal` — Create and activate a durable goal (`{ objective }`)
- `update_goal` — Transition goal status (`{ status: "active" | "paused" | "complete" | "cleared" }`)

## CLI Flags

- `--no-goals` — Disable automatic goal continuation
- `--goal-max-idle <n>` — Maximum consecutive continuations without tool calls before auto-pausing (default: `3`)

## Visual Parity

- **Status line**: Right-aligned dim `Goal active (<duration>)` / `Goal paused (<duration>)` above the editor with live 1-second active timer
- **Continuation marker**: Bold `Continuing goal` message in the conversation transcript
- **Tool call headers**: `Creating goal` / `Created goal` and `Updating goal` / `Updated goal` with dim objective/status and error detail
