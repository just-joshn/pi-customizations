# Gondolin VM

Pi's built-in tools (`read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`) and `!` shell commands run inside a Gondolin micro-VM. The directory Pi started in is mounted read-write at `/workspace`, and the package is mounted read-only at its host path. Every other guest path is the VM's own. `tmux_run` jobs and `subagent` workers run on the host. Each claim needs an attempted action and an independently observed host state.

## Sub-features

- `vm-boot`: the VM boots at session start; the status line reads `Gondolin: <8 hex> (/workspace)`.
- `vm-status`: `/gondolin` shows the VM id, host workspace, guest workspace, and shell.
- `vm-shell`: `!` commands run in a Linux guest at `/workspace` that has `node` but no `git`, `gh`, `tmux`, or `bun`.
- `vm-write-through`: a guest write under `/workspace` reaches the host file.
- `vm-outside`: a guest write outside `/workspace` stays in the VM; the host file is unchanged.
- `vm-package-ro`: the package is readable at its host path in the guest, and writes there fail.
- `vm-host-paths`: other host paths, such as the Pi agent directory, do not exist in the guest.
- `vm-prompt`: the model's working-directory line names `/workspace` and the host directory, followed by the host-boundary note.
- `vm-model-tools`: the model's tools act on the guest.
- `vm-shutdown`: quitting Pi ends its VM process.

## How to get to it (user POV)

- Start Pi; watch the status line.
- Type `/gondolin`, or a `!` command, in the editor.
- Ask the model to use its file and shell tools.

## Driving it with the PTY helper

Preconditions:

- Healthy doctor, including QEMU. The model-free steps need no login; the model steps need a logged-in model.
- Resolve WORK, OUTSIDE (scratch/outside.txt, containing `PSTACK_OUTSIDE_UNCHANGED`), PKG (the checkout's `extensions/pi-pstack-v2`), and the child PID from state.json and scratch `child.pid`.
- Type each command, capture the draft, then send `$'\r'` in a separate action. Several result markers also appear in the typed command; read the output block, not just a grep hit.

Model-free:

- **Status:** submit `/gondolin`. Capture 07-gondolin-status.txt; require `Gondolin VM: <id>` whose first 8 characters match the status line, `Host workspace: <WORK>`, `Guest workspace: /workspace`, and `Shell: /bin/bash` (or `/bin/sh`).
- **Guest shell:** submit `!pwd; uname -s; for c in git gh tmux bun node; do command -v $c >/dev/null && echo "has-$c" || echo "no-$c"; done`. Require `/workspace`, `Linux`, `no-git`, `no-gh`, `no-tmux`, `no-bun`, `has-node`.
- **Write-through:** submit `!printf IN_VM > vm.txt && echo wrote-vm`. Read WORK/vm.txt on the host; require `IN_VM`.
- **Outside write:** submit `!printf CHANGED > ../outside.txt && cat ../outside.txt && echo outside-done`. Require the guest to print `CHANGED`, and the host OUTSIDE to still read `PSTACK_OUTSIDE_UNCHANGED`.
- **Package mount:** submit `!head -c 40 <PKG>/package.json && echo pkg-read-ok`; require `"name": "@justjoshn/pi-pstack-v2"`. Submit `!touch <PKG>/verify-ro-probe; echo touch-exit=$?`; require `Read-only file system` and `touch-exit=1`, and confirm `<PKG>/verify-ro-probe` is absent on the host.
- **Host paths:** submit `!ls <host home>/.pi 2>&1; echo ls-exit=$?`; require `No such file or directory` and `ls-exit=1`.
- **Shutdown:** before quitting, record the QEMU process that descends from the isolated Pi's child PID (`pgrep -P` recursively). This session's own VM is also QEMU, so never match by name alone. Quit per ../SKILL.md cleanup; require Pi's exit and that QEMU PID gone.

Model-required:

- **Prompt:** ask `Quote your current working directory line verbatim, and the sentence after it about what the VM lacks.` Require `/workspace (Gondolin VM; host workspace mounted from <WORK>)` and a note that the VM has no `git`, `gh`, `tmux`, or `bun`.
- **Model tools:** ask `Use the write tool to create model.txt containing MODEL_OK, read it back, then run bash: pwd && cat model.txt.` Require the host WORK/model.txt to contain `MODEL_OK` and bash to print `/workspace`.
- **Host routing:** ask `Run git status in this repository.` Require guest bash to fail on `git`; if the model then uses `tmux_run`, record that the job ran on the host.

## Gotchas

- `/reload` restarts the extensions, so the VM id changes; compare ids within one boot.
- A guest path outside `/workspace` is the VM's own filesystem, so an outside write that "succeeds" in the guest is the expected result. The host sentinel is the evidence.
- The first boot can be slow while Gondolin downloads its guest image.
- This feature does not establish network isolation; make no claim about it.
- `outsideUnchanged` in cleanup.json is one sentinel, not proof of every VM boundary.
