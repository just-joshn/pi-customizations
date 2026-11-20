# Set up pstack

Install the package, choose a model for each role, and run a first task.

## Install the package

Install from npm:

```text
pi install npm:@justjoshn/pi-pstack-v2
```

To install from a checkout instead, pass its path:

```text
pi install ./extensions/pi-pstack-v2
```

Add `--local` to write the declaration to the project's `.pi/settings.json` instead of your personal settings. `pi list` shows what is installed.

The package needs Node `>=22.19.0` and is built and tested against Pi 1.5.2. Do not install another pstack package beside it. Skill names collide, and Pi keeps only the first it finds.

npm 11.20 and later warn that `ssh2` and `cpu-features` have install scripts that `allowScripts` does not cover. Both come from Gondolin. The scripts only try to compile optional native speedups, and the Gondolin virtual machine boots without them. Deny both once after installing:

```text
cd ~/.pi/agent/npm && npm install-scripts deny ssh2 cpu-features
```

Installing adds skills, tools, and commands but starts no workflow. Nothing changes until you send `/skill:poteto-mode` or turn on `/pstack-mode`.

## What the package adds

Skills run as `/skill:<name>`. The extensions add two commands of their own:

- `/pstack-mode <skill>` keeps one skill in the system prompt on every turn until `/pstack-mode off`.
- `/gondolin` shows the session's Gondolin VM, a micro virtual machine.

The extensions add four tools:

- `subagent` starts separate Pi workers, each in its own tmux session. One call runs a single worker, up to eight `tasks` in parallel with four running at a time, or a `chain` of steps. A blocking call returns the reports when the workers finish. With `wake`, the call returns a job id at once and wakes your session with the report. `stop` aborts a wake job by id. `model`, `thinking`, and `isolation: "worktree"` apply per call or per task.
- `tmux_run` runs a shell command in its own tmux session. The session wakes only when you set `wake`. With `repeat: true`, which requires `wake`, the command restarts after each clean exit.
- `tmux_jobs` lists, reads the output of, waits on, and stops `tmux_run` jobs.
- `report_findings` records structured review findings.

Gondolin also routes Pi's seven built-in tools to the VM: `read`, `write`, `edit`, `bash`, `ls`, `find`, and `grep`. The `--gondolin-shared-build-cache` flag shares package-manager caches between the VM and host jobs.

Pi has no sub-agents and never runs shell commands in the background. Every parallel worker in this guide is a `subagent` worker, and every watcher is a `tmux_run` job.

`tmux_jobs` with `action: "list"` shows each job and prints a `tail -f` command that follows its output. Use `output` to read a job's log, `wait` to block until jobs finish, and `stop` to end one. When a job with a `wake` exits, its report arrives as a steering message after the current tool calls finish.

## Check the requirements

- Node `>=22.19.0`.
- tmux. Every job runs in a tmux session, and the wake that returns a report depends on it.
- QEMU for the Gondolin VM. Install it with `brew install qemu` on macOS. Gondolin downloads its guest image on first use.
- `bun` and `gh`, for scripts that some skills run, such as `watch-pr` and `statechart`.
- `jq` and `rg`, which is ripgrep, for `worktree-audit.sh` and the `pr-review-canvas` skill.

Pi has no permission popups. Pi's built-in tools run inside the Gondolin VM instead. The directory Pi started in is mounted at `/workspace`, and writes there reach your checkout. Every other guest path belongs to the VM.

The VM covers Pi's built-in tools, not `tmux_run` jobs or the `pi` processes that `subagent` starts. Those run on your machine. The guest has no `git`, `gh`, `tmux`, or `bun`, so commits, pushes, and pull requests go through `tmux_run`.

## Pick your models

Run:

```text
/skill:setup-pstack
```

[`/skill:setup-pstack`](../../skills/setup-pstack/SKILL.md) detects the models you can use and asks for a reasoning budget. It shows each role and asks whether to change it. It writes `~/.pi/agent/pstack-v2-models.md`, a file of role lines that the extension adds to the system prompt in every session.

Each role line names a model as `provider/id`, exactly as `pi --list-models` prints it, and a thinking level.

The defaults match the `large` budget. Code, prose, and judgment roles run at `xhigh` thinking. The review panels and swarm workers run at `high`. No role runs above `xhigh`. `medium` lowers each role one level and `small` lowers it two, so both spend fewer tokens.

`/skill:poteto-mode` then adjusts the thinking level for each job. It raises the level one step for the hardest work and lowers it for judgment or routine work. Panel seats keep their listed level.

A role with no line in the file keeps the skill's default. To restore a default, delete that role's line. A rerun of `/skill:setup-pstack` keeps every role whose model differs from the default. A file written before a default changed still pins the old default. Rerunning `/skill:setup-pstack` replaces the old defaults it recognizes and tells you which. To drop a pin it does not recognize, delete that role's line or the file first.

To make a role follow your session model, set it to `inherit-parent` or `auto`. pstack then omits the model on that role's `subagent` call. Neither value is a model. A panel role takes a list, and one subagent worker runs per entry, so the list length sets the panel size. Setup also configures `swarm workers`, the default model for every `/skill:swarm` worker unless a race names a model for each arm.

The extension rereads the file every turn, so role lines apply from your next message.

## Accept or decline the verification offers

At the end of setup, `/skill:setup-pstack` looks for a way to prove app behavior, either a `verify-*` skill or an existing test script. If it finds neither, it offers once to generate a verification skill with [`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

If you accept, it writes `.pi/skills/verify-<app>/`, a project skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. If you decline, setup moves on, and you can run the skill later. Setup itself installs no browser driver, dependency, or app environment. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) has the details.

An agent that can check its own work keeps going until the check passes. An agent that cannot check hands every result back to you. Accept this offer if you are new to pstack.

Setup then offers once to generate a formal verification skill with [`/skill:create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone wrote. A formal verification skill checks one key property, such as "a job never runs twice at once", in every case within a stated scope. Accept when your code has concurrency, retries, a state machine, or a parser. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) has the details.

## Control the cost

pstack spends extra tokens on subagent workers and review panels. To spend fewer:

- Rerun `/skill:setup-pstack` and pick a smaller reasoning budget or cheaper models. A strong session model with cheaper models in the code roles is a good split.
- Set a role to `auto` or `inherit-parent`, so it runs on your session model.
- Shorten a panel list. Each entry runs one subagent worker.
- Use `/skill:poteto-mode` only for work that needs rigor. A small, obvious edit does not.

## Run your first task

Pick a small, real task:

```text
/skill:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

`/skill:poteto-mode` writes `TODO.md` at the root of your checkout. Its first items are the matched playbook's steps, the Feature playbook for this prompt. `TODO.md` is working state, so it is never staged. If the repository already tracks a `TODO.md`, the checklist goes to `.pi/TODO.md` instead.

`/skill:poteto-mode` attaches the skill to one message, and its influence fades as the session moves on. To keep it active, type `/pstack-mode poteto-mode`. The extension then puts the skill in the system prompt on every turn, through `/compact` and session resume, until `/pstack-mode off`.

Next: [Route work through `/skill:poteto-mode`](./02-poteto-mode.md).
