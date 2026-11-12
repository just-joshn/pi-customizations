# benny

benny gives you two pi-pstack automations for slack issue reports. one triages each report. the other reproduces confirmed bugs and may prepare a small draft fix.

the files in this directory are dormant setup and automation sources. they do not appear as slash skills.

## set it up

1. point pi at [`FOR_AGENTS.md`](./FOR_AGENTS.md) and name the target repository.
2. let setup merge this whole directory into the target at `.pi/automations/benny/`. it must preserve destination-only files and review conflicts instead of overwriting local edits. `node scripts/benny-setup.mjs --project <target>`, run from the pi-pstack package root, does the copy, the settings merge below, and the webhook secret, and it never replaces a file that differs.
3. let setup enable pi-pstack in the target repository's `.pi/settings.json` for shared dependencies:

```json
{
	"packages": ["npm:@justjoshn/pi-pstack"]
}
```

4. keep user-owned configuration outside the copied pack, for example in `.pi/benny/`. adapt [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md).
5. commit `.pi/settings.json`, `.pi/automations/benny/`, and any secret-free configuration before enabling either automation.
6. store the slack bot token in `~/.pi/agent/pstack/credentials/slack.json` as `{ "token": "xoxb-..." }` with mode 0600. only the pi-pstack process that runs the automation reads it. workers never get it. for the github tracker, sign in with `gh auth login` as the user that runs the automation.
7. start each automation with `/pstack automation start <name>`, where the names are `automations.triage_name` and `automations.reproduce_name` in `.pi/benny/configuration.yaml`. each one runs as a watch worker in tmux on this machine, not in a hosted environment. `/pstack automation status <name>` shows its receiver url and `/pstack automation stop <name>` ends it.
8. point your slack event sender at the receiver url (`POST /events` with the webhook secret from `~/.pi/agent/pstack/credentials/<name>.json`), then send a harmless test report and verify every source-channel post stays in the original thread.
