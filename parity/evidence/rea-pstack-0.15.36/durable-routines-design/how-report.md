# How report. Durable routines supervisor (design)

**User goal.** 100% Pi-native parity with Cursor pstack on routine and timer lifetime. Wakes must keep firing after the interactive chat process exits, using Pi mechanisms only (no Cursor pstack plugin).

**Scope.** Read-only design. No edits under `extensions/pi-pstack` in this unit.

## Overview

Today every subscription is an in-process actor. Create tools append a custom session entry, arm `setTimeout` loops or a local HTTP listener, and shut all of that down on `session_shutdown`. The session file still holds the last `{ subscriptions: [...] }` list. Nothing outside that Pi process reads it until the same session is opened again.

Cursor Automations keep a hosted identity after a local IDE quit. The local Pi substitute is a process that outlives the interactive chat and re-arms from a durable desired-state store.

## Key Concepts

### Persistence shape already in source (measured)

Custom session entry type `pstack/subscriptions` (`SUBSCRIPTIONS_ENTRY`). Newest branch entry wins in `subscriptionsFromBranch`.

Each item must match `SubscriptionSchema`:

```ts
{
  id: string;           // e.g. "sub-" + 8 hex
  name: string;
  createdAt: number;    // epoch ms
  expiresAt: number;    // epoch ms; default now+7d; max +30d via expiresInHours
  config:
    | { kind: "github"; target: GithubTarget }
    | { kind: "timer"; prompt: string; cron?: string; delaySeconds?: number; once: boolean; strategy: "wake_self" | "new_session" }
    | { kind: "webhook"; prompt: string; slug: string };  // slug === routineSlug(name)
}
```

Live-only fields (not persisted): `timers`, `baseline`, `lastEvent`, `lastError`, `url`, cron minute cursor.

Credentials for webhooks already live on disk at `<pstack dir>/routines/<slug>/credentials.json` (`key`, mode 0600). That path survives process exit. The subscription list does not, as a live schedule.

### Lifetime today (measured)

- Arm on create and on `session_start` / `session_tree` via `restore`.
- Disarm on `session_shutdown` (`active = false`, clear timeouts, close `RoutineServer`).
- Print and JSON modes reject every subscribe tool (`isOneShot`). Subagents (`childIdentity.depth > 0`) are one-shot too.
- README Limits. Subscriptions and routines live in the Pi process that created them. Keep the session running (for example in tmux) while they matter. Only one process can hold the routines port.

### Wake delivery today (measured)

- `wake_self`. `pi.sendMessage` with `customType: pstack/subscription`, `triggerTurn: true`, `deliverAs: "followUp"`.
- Timer `new_session`. `options.runFresh` → `task.startBackground` in the owning process.
- Webhook. `RoutineServer` on `127.0.0.1` (`PSTACK_ROUTINES_PORT` or 47913) routes POST into the same wake path.

## How It Works (status quo flow)

1. Interactive or RPC Pi loads `registerSubscriptions`.
2. Agent calls `subscribe_*`. Entry lands in the session branch and in the in-memory `live` map.
3. Timers and the routines listener run only while that process is alive.
4. Exit clears live state. Session JSON still has the list. Port frees. Credentials files remain.
5. Resume of that session calls `restore`, re-arms, and GitHub takes a new baseline (changes while down are missed). Once timers due while down fire on restore; repeating delay timers resume cadence from `createdAt`.

The durability gap is step 4. Desired state is stuck in a session file nobody is scheduling.

## Where Things Live

| Concern | Path |
|---|---|
| Session list | Pi session branch custom entry `pstack/subscriptions` |
| Credential files | `<pstack dir>/routines/<slug>/credentials.json` |
| Workspace state | `<pstack dir>/workspaces/<workspaceSlug>/` |
| Package code | `extensions/pi-pstack/src/subscriptions/{index,cron,webhook,github}.ts` |
| Design / gap | `parity/pi-pstack-0.15.36/design.md` §2.3–2.4; `gap-list.md` item 1 |

## Competing approaches

Principles applied while comparing. Foundational Thinking (name the durable data shape before process layout). Laziness Protocol (prefer reuse of `Config` / `RoutineServer` / cron over a second schedule language). Separate Before Serializing Shared State (do not let interactive chat and a supervisor both mutate one live map or one last-fire file). Make Operations Idempotent (create, restore, and fire must converge after crash or double start).

### Approach A. Detached supervisor daemon + disk desired-state registry

**Idea.** Mirror each subscription into a workspace-scoped durable registry under `<pstack dir>`. A long-lived Node supervisor (package bin) is the sole process that arms timers, GitHub polls, and `RoutineServer`. On fire it either spawns a headless Pi run (`new_session`-shaped) or parks a wake record for the next interactive resume. Interactive chat becomes a control plane that writes desired state and optionally attaches for live `wake_self` when it is up.

**Fits current shape.** Reuses `Subscription` / `ConfigSchema` bytes as the registry payload. Credentials stay where they are. Supervisor imports the same cron, github, and webhook modules.

**Strengths.** One always-on process covers all three kinds. Clear writer split (chat → desired state; supervisor → runtime ledger). Survives TUI quit, logout of the chat, and session switch. Matches the phase-B sketch ("detached daemon or equivalent").

**Costs.** New dual-write path on create/unsubscribe. Need a start story (manual bin, optional launchd/systemd unit that only launches that bin). Port ownership moves to the supervisor. `wake_self` while the owner chat is dead needs an explicit policy (park vs force `new_session`).

### Approach B. OS timer units (launchd / systemd) + small one-shot runner

**Idea.** Each timer becomes a calendar/`OnCalendar` or `StartInterval` unit that execs a small runner (`pi` print/RPC once with the prompt). Webhooks and GitHub polls still need a separate always-on unit because they are not point-in-time fires.

**Fits current shape.** Cron strings map awkwardly to launchd/systemd calendars (5-field local cron with day-or semantics). Delay/`once` timers map cleanly. Session `Subscription` list is not enough; each unit needs its own installed file derived from the registry.

**Strengths.** OS restarts the timer jobs after reboot without a custom supervisor loop. Familiar ops model on servers.

**Costs.** Three mechanisms for three kinds (calendar units + always-on webhook unit + poll unit), or you collapse into Approach A anyway. Platform templates diverge (macOS vs Linux). Idempotent install/uninstall of units is easy to get wrong. Print mode today rejects subscribe tools and exits when the agent settles, so the runner must be a dedicated path, not "reuse print subscribe".

**Verdict vs A.** Use OS units only as an optional *launcher* for Approach A's single bin, not as the schedule engine for every subscription kind.

### Approach C. Session watchdog that re-spawns headless Pi on the same session

**Idea.** On first durable subscribe, detach a `pi --mode rpc` twin that loads the same session file, runs the existing `restore` path, and keeps arming. A tiny watchdog restarts that twin if it dies. Interactive TUI can exit; the twin owns live subscriptions using today's code almost unchanged.

**Fits current shape.** Maximum reuse of `createSubscriptions` / `restore` / `wake`. Laziness Protocol looks attractive at first.

**Strengths.** Smallest change to arming logic. Session entry remains the source of truth. Resume semantics for once-timers already exist.

**Costs.** Two processes contest one session writer (design.md §2.8 style locks exist for agents; session branch append from two owners is unsafe). Interactive resume while the twin is alive risks double arming and `EADDRINUSE` on the routines port. `wake_self` into a headless twin runs turns the user never sees unless they attach. Watchdog + twin is still a daemon, just coupled to Pi session I/O.

**Verdict vs A.** Reject as the primary design. The shared session file is the wrong shared mutable object. Separate desired state (A) instead of serializing two Pi processes onto one session.

## Comparison against real persistence

| Question | Today | A (daemon + registry) | B (OS units) | C (headless twin) |
|---|---|---|---|---|
| Where is desired state? | Session custom entry only | Session entry + disk registry (same `Subscription` body) | Unit files + somehow synced list | Session entry only |
| Who arms live timers? | Interactive / RPC process | Supervisor only | launchd/systemd + always-on unit | Headless twin |
| Webhook port owner | Creating process | Supervisor | Always-on unit (same as A in practice) | Twin (conflicts if chat also restores) |
| Survives chat exit? | No | Yes | Yes if units installed | Yes if twin stays up |
| Survives reboot? | No | Only if supervisor is installed as a user agent | Yes for calendar units; webhook unit must be enabled | Only if watchdog is an OS agent |
| Double delivery risk | Low (one process) | Managed via runtime ledger | High if chat also restores | High (twin + interactive) |

## Gotchas (from source, for any approach)

- `isOneShot` blocks subscribe in print/JSON and in Task children. A durable fire that runs work must not go through those reject paths for *creating* subscriptions; the fire runner is allowed to be print/RPC for the prompt alone.
- Re-subscribe by name returns `created: false` and does not update. Durable mirror must keep that Cursor-matching rule.
- GitHub restore always rebases baseline. Downtime gaps stay; durability does not invent missed PR events.
- Default port 47913. Second listener fails with a clear `EADDRINUSE` message naming `PSTACK_ROUTINES_PORT`.
- Credential `ensureCredentials` is create-if-missing and idempotent across processes (wx + retry). Do not rotate keys on supervisor start.
- Expiry still applies. Supervisor must drop expired records the same way `expired()` does today.
