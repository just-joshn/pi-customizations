# benny automation intent

## what i want to automate

i want two pi automations that work together in one slack issue channel. each one is a pi-pstack subscription in a long-running pi session rooted in the target repository.

### automation 1: triage issue reports

- trigger: when someone posts a new top-level report in my configured source slack channel, i want this automation to start on that report and keep its original thread coordinates. by default a `subscribe_timer` sweep on a cron schedule finds the report; a `subscribe_webhook` routine fed by my slack app or relay is the push alternative.
- behavior: i want it to read the thread and attachments, classify the report as a bug or performance issue, feature request, question or feedback, or reroute, and trace the likely owning layer before routing.
- tracker: i want it to search my configured tracker for duplicates, update a confident duplicate, and create a ticket only for a clear net-new bug.
- tools: i want slack thread read and reply access through my slack mcp server, my configured tracker integration, and my optional routing map.
- outcome: i want exactly one reply in the source thread with a short verdict and `[benny:bug]`, `[benny:performance]`, or `[benny:other]`. a bug or performance marker may include the tracker url.
- boundary: i never want this automation to post a root message in the source channel.

### automation 2: reproduce and fix confirmed bugs

- trigger: i want this automation to start from the same new top-level report, or another supported trigger chosen during setup, then wait for the trusted triage marker in the original thread.
- gates: i want it to stop when someone clearly owns the fix. if an existing pull request or merged commit may fix the report, i want verification instead of a competing change.
- behavior: i want it to use my configured control adapter and feature map, reproduce the exact symptom twice through the real ui, and capture screenshots, video, and a read-only state cross-check.
- fix: i want it to verify existing pull requests without authoring over them. after a confirmed repro, it may attempt one bounded root-cause fix, use tdd when the test is cheap, smoke the blast radius, and open a draft pull request only when before-and-after proof passes.
- tools: i want slack thread read and reply access through my slack mcp server, repository and history access, draft pull request creation with `gh`, my configured tracker, and my control adapter.
- outcome: i want evidence and a verified result in the source or optional operations threads, plus an optional draft pull request. updates should be concise.
- boundary: i never want this automation to post a root message in the source channel.

### shared rules

- i want the source channel and root thread coordinates to stay immutable for the whole run.
- i treat utility and debug bots as evidence, not delegation or fix ownership.
- i allow subagents to help, but they cannot post to slack or receive slack credentials. analysis subagents run as `Task` with `readonly: true`, which gives them no mcp servers and no network.
- i want this entire pack committed at `.pi/automations/benny/` in the target repository. its `SKILL.md` files are direct automation instructions, not skills pi discovers.
- i want pi-pstack installed in pi for shared dependencies such as `how`, `why`, `tdd`, `unslop`, and the required principle skills.
- i want each subscription prompt to read its operational file directly from the target repository. i do not want pi-pstack package paths, copied excerpts, or slash-skill discovery.
- i keep user-owned configuration, feature maps, routing maps, memory, and secrets outside `.pi/automations/benny/` so pack refreshes cannot overwrite them.
- i want durable memory as files in one directory setup names, such as `~/.pi/agent/pstack/automations/benny/memories/`: a claim ledger so no report runs twice, and short operating notes.
- i want both automations to fail closed when channel coordinates, tracker access, the control adapter, or the feature map are missing or uncertain.
- i want draft pull requests only. do not merge or deploy.

### my configuration

- source slack channel: `<channel>`
- optional operations channel: `<channel or none>`
- repository and default branch: `<repo>`, `<branch>`
- tracker: `<type, team, project, labels, intake status>`
- routing map: `<path or none>`
- triage identity: `<slack identity>`
- control skill: `<configured skill or adapter>`
- feature map: `<committed same-repo path outside the copied pack, or behavior to paraphrase>`
- trigger mode: `<timer with cron schedules, or webhook with my relay>`
- memory directory: `<path>`
- models: `<triage, reproduce, code, media review, as pi model specs>`
- status emoji strings: `<seen, reproducing, reproduced, blocked, fixing, failed, pull request opened>`
- budgets: `<polling, verdict wait, follow-up, repro, rejection, fix>`
- optional bot token capability: `<none, file download, or editable operations status>`

start from [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md). copy and fill them outside this pack, for example under `.pi/benny/`. keep secret values in a secret manager or environment.

## for the agent

the human enters setup by pointing pi at this file. do not look for or invoke a discovered benny slash skill.

1. ask which repository will run the automations.
2. treat the directory containing this `FOR_AGENTS.md` as the source pack.
3. merge the entire source pack into `<target-repository>/.pi/automations/benny/`.
4. preserve every destination-only file. never delete unrelated files or overwrite user-owned configuration, feature maps, routing maps, or memory.
5. when an existing destination file at a source-managed path differs, review the diff and merge without discarding local edits. if ownership is ambiguous, stop and ask before replacing it.
6. verify that the copied `FOR_AGENTS.md` and `skills/setup-benny/SKILL.md` exist in the target repository.
7. read and follow `.pi/automations/benny/skills/setup-benny/SKILL.md` directly from the target repository.

i want pi-pstack installed in pi, either for me (`pi install <path-to-pi-pstack>`) or for the target repository (`pi install -l <path-to-pi-pstack>`, which writes `.pi/settings.json`). preserve every unrelated setting and package when that file already exists.

i want this setup session to run in the target repository, so a fresh subagent it starts runs there too, and i want verification from that subagent. confirm that pi-pstack's `how`, `why`, `tdd`, `unslop`, and the principle skills used by benny are installed there. do not count a skill this session loaded by hand.

if pi-pstack or any shared dependency does not resolve, stop and explain what failed. do not move `.pi/automations/benny/skills/` into `.pi/skills/` or expect its files to appear in the slash-skill list.

tell me that creating a subscription auto-starts `pstack-routines-supervisor`, that Benny's owner-session wakes park while this chat is offline until the same session is restored, and that subscriptions expire after seven days unless renewed. only `new_session` timers can start detached work while the owner is offline. for reboot survival, ask whether to run `packaging/install-supervisor-unit.sh --workspace <target-repository>` and run it when i say yes. do not create or update a subscription until i explicitly ask.

for first-time creation, create the triage subscription first, check it with `list_subscriptions`, and confirm one harmless fire before creating the repro subscription.

fill each prompt template from the finished configuration. the triage prompt must read and follow `<target-repository>/.pi/automations/benny/skills/triage-issue-reports/SKILL.md`. the repro prompt must read and follow `<target-repository>/.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`.

for existing subscriptions, check them with `list_subscriptions`. a subscription keeps its prompt when you subscribe again with the same name, so changing one means `unsubscribe`, then subscribing again. do not create duplicates under new names.
