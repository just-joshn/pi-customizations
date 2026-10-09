---
name: verify-hello-cli
description: Verify the hello-cli fixture, a one-line shell CLI (./hello.sh) that prints HELLO-FAMILY-13. Use when you need proof that the hello print works, with captured stdout, stderr and exit code.
---

# verify-hello-cli

hello-cli is a single POSIX shell script, `hello.sh`, in the repo root. Its surface is the command line; it takes no input and keeps no state.

## Launch

There is nothing to build or install. Each drive is a fresh run of `./hello.sh` from the repo root. It is ready when the process exits; there is no server, port, or prompt. Teardown is not needed beyond Cleanup below.

## Doctor

Read-only check that the script is worth driving:

```bash
test -x ./hello.sh && head -1 ./hello.sh && echo doctor-ok
```

It must print `#!/bin/sh` and `doctor-ok`. If not, run `chmod +x hello.sh` only if the user agrees, or report the break.

## Drive

Run the real command and capture all three channels:

```bash
mkdir -p .pi/evidence/verify-hello-cli
./hello.sh >.pi/evidence/verify-hello-cli/stdout.txt 2>.pi/evidence/verify-hello-cli/stderr.txt
echo $? >.pi/evidence/verify-hello-cli/exit-code.txt
```

No PTY or tmux is required because the script reads no input. Instances are independent, so several can run in parallel.

## Evidence

Proof lives in `.pi/evidence/verify-hello-cli/`:

- `stdout.txt` must equal exactly `HELLO-FAMILY-13` followed by a newline.
- `stderr.txt` must be empty.
- `exit-code.txt` must contain `0`.

Check with `cat` and `test ! -s stderr.txt`. Run the real script, not a copy or an echo of the expected string. The script has no side effects (no files, network, or git refs), so there is nothing further to verify; confirm that by noting that the working tree has no new files other than the evidence directory (`git status --short` or `ls`).

## Cleanup

Nothing is started in the background, so there are no processes to stop. Do not kill anything by process name. Remove only scratch files you created outside the evidence directory. Leave `.pi/evidence/verify-hello-cli/` in place: those are the proof artifacts.

## Helpers

None
