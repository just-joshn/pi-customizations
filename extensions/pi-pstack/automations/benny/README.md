# benny

benny gives you two pi automations for slack issue reports. one triages each report. the other reproduces confirmed bugs and may prepare a small draft fix.

a pi automation is a pi-pstack subscription rooted in the target repository. creating one auto-starts `pstack-routines-supervisor`. owner-session wakes received while the setup chat is offline park until that same session is restored. a scheduled sweep is `subscribe_timer` with a cron schedule. each fire hands one report to a background subagent on the automation's model. a push trigger is `subscribe_webhook`: a slack app or relay you run posts each new report to the local routine url. slack reads and writes go through a slack mcp server configured in pi (`pi mcp list`). durable memory is plain files in a directory setup names, such as `~/.pi/agent/pstack/automations/benny/memories/`.

the files in this directory are dormant setup and automation sources. they do not appear as slash skills.

## set it up

1. install pi-pstack (`pi install <path-to-pi-pstack>`) and configure a slack mcp server in pi. `pi mcp list` must show it.
2. start pi in the target repository and point it at [`FOR_AGENTS.md`](./FOR_AGENTS.md).
3. let setup merge this whole directory into the target at `.pi/automations/benny/`. it must preserve destination-only files and review conflicts instead of overwriting local edits.
4. keep user-owned configuration outside the copied pack, for example in `.pi/benny/`. adapt [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md).
5. commit `.pi/automations/benny/` and any secret-free configuration, so pack refreshes stay reviewable.
6. when you ask, setup creates the two subscriptions and checks them with `list_subscriptions`. then send a harmless test report and verify every source-channel post stays in the original thread.

## what differs from hosted automations

creating a subscription auto-starts `pstack-routines-supervisor`. keep the owning pi session running for immediate handling, or restore it later to drain parked wakes. only a timer explicitly configured with `sessionStrategy: "new_session"` starts detached work while its owner is offline. for reboot survival, run `packaging/install-supervisor-unit.sh --workspace <target-repository>` (idempotent launchd or systemd user unit). if the supervisor cannot start, subscriptions still arm in the creating pi process and stop when that process exits, so tmux still works as a fallback. they expire after seven days by default: `list_subscriptions` shows `expiresAt`, and renewing one means `unsubscribe`, then subscribing again with the same name. a webhook routine listens on `127.0.0.1` only, so slack cannot reach it directly. a push trigger needs a relay you run.
