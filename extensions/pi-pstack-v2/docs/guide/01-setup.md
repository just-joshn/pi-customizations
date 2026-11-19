# Set up pstack

In this page you install the package, pick which models pstack uses, and run your first task. Setup is one install command plus a short conversation.

## Install the package

Install pstack as a Pi package from a checkout, by passing its local path:

```text
pi install ./extensions/pi-pstack-v2
```

The npm package `@justjoshn/pi-pstack-v2` is not published yet. Once it is, `pi install npm:@justjoshn/pi-pstack-v2` works too.

Add `--local` to write the declaration to the project's `.pi/settings.json` instead of your personal settings. `pi list` shows what is installed. Installing adds the skills and tools but starts no workflow. Nothing changes until you send `/skill:poteto-mode` or turn on `/pstack-mode`. Pi runs each skill as `/skill:<name>`, so every command in this guide takes that prefix.

The package adds three tools. `pi_spawn` starts a separate Pi in its own tmux session. `tmux_run` runs a shell command in its own tmux session. `tmux_jobs` lists, waits on, and stops both kinds of job. Pi has no sub-agents and no detached shell, so every parallel worker and every watcher in this guide is one of these jobs.

**Watch your workers.** `tmux_jobs` with `action: "list"` shows each job and prints a `tail -f` command that follows its output. Use `output` to read a job's log and `wait` to block until jobs finish. Use `stop` to end one. When a job exits, its report arrives in your session as a steering message after the current tool calls finish, so you can keep working or end your turn and wait.

## Check tmux and a container runtime

pstack needs two things on your machine.

- **tmux.** Every job runs in a tmux session, and the wake that brings a finished job's report back to your session depends on it.
- **A container runtime.** Pi has no permission popups. Each `pi_spawn` and `tmux_run` job runs inside an isolated Linux container instead, and a job can write only to its own directory, its worktree or working directory, the repository's git directory, and private temp directories. On macOS, install Apple `container`, then run `container system start`. On Linux and WSL2, install Podman (preferred) or Docker. With no runtime, the tools refuse to start. The first job builds a job image, which can take a few minutes.

The container covers the jobs, not your main session. To contain the main session too, run Pi inside an isolated environment, as Pi's guide to isolated environments describes. Do that before you run anything unattended.

## Pick your models

Run:

```text
/skill:setup-pstack
```

[`/skill:setup-pstack`](../../skills/setup-pstack/SKILL.md) detects the models you have access to, asks for a reasoning budget, shows you each role (code workers, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.pi/agent/pstack-v2-models.md`, a small file of role lines that the extension puts in front of the model in every session.

Each role line names a model as `provider/id`, exactly as `pi --list-models` prints it, and a thinking level.

The defaults are the same as the `large` budget. Code, prose, and judgment run at `xhigh` thinking, and the review panels and swarm workers run at `high`. No role runs above `xhigh`. Outside a review panel, a stronger model than your default runs only when you name it for a task or after two runs of the same brief fail their check. `medium` lowers each role one level and `small` lowers it two, and both spend fewer tokens.

You only override what you care about. A role with no line in the file keeps the skill's default. To restore a default, delete that role's line. A rerun of `/skill:setup-pstack` keeps any role whose model differs from the default. When a default changes, a file written before the change still pins the old default until you run `/skill:setup-pstack` again. That run replaces the old defaults it recognizes, tells you which, and keeps your other choices. To drop a pin it does not recognize, delete that role's line or the file first.

You might be wondering what happens if you want a role to follow whatever model you're using. Set it to `inherit-parent` or `auto` and pstack omits the model on that role's `pi_spawn` call, so the spawned Pi runs on your session model. Both values mean the same thing, and neither is a model. For a panel role the value is a list, and one spawned Pi runs per entry, so the list length sets the panel size. Setup also configures `swarm workers`, the default model for every `/skill:swarm` worker unless a race names a model for each arm.

## Accept the verification offers, or don't

At the end of setup, `/skill:setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.pi/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/skill:create-verification-skill` yourself any time. Either yes starts a separate generation task. Setup itself installs no browser driver, dependency, or app environment. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to pstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/skill:create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

The extension rereads the model file every turn, so the role lines apply from your next message. A new session picks them up too.

## Keep the cost in check

pstack spends extra tokens on spawned Pis and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/skill:setup-pstack` and pick a smaller reasoning budget or cheaper models. A strong model in your main session with cheaper models in the code roles is a good split.
- Set a role to `auto` or `inherit-parent` so it runs on your session's own model.
- Shorten a panel list. Each entry runs one spawned Pi.
- Save `/skill:poteto-mode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/skill:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch `TODO.md` at the root of your checkout. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. `TODO.md` is working state, so don't commit it unless your repository already tracks one.

From here you can type normal follow-ups. The skill's text stays in your session's context, so short messages keep the same rigor. After a `/compact` or in a new session, send `/skill:poteto-mode` again. To keep it on for the whole session instead, type `/pstack-mode poteto-mode`. The skill then rides in the system prompt every turn, through `/compact` and resume, until `/pstack-mode off`.

Next: [Route work through `/skill:poteto-mode`](./02-poteto-mode.md).
