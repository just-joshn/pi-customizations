## 1) Feature summary

The `exit zero` feature works because `hello.sh` is an executable POSIX shell script whose only command is `echo HELLO-FAMILY-13`. Since `echo` succeeds and no later command fails, the script—and therefore `./hello.sh`—finishes with exit code `0`. The expected captured exit code is explicitly documented as `0`.

## 2) Source entry points (file:line)

- `hello.sh:1` — Declares the POSIX shell interpreter: `#!/bin/sh`.
- `hello.sh:2` — Runs `echo HELLO-FAMILY-13`; successful completion produces the process’s zero exit status.
- `README.md:6-9` — Documents running `./hello.sh`, its output, and that it exits `0`.
- `.pi/skills/verify-hello-cli/features/exit-zero.md:3` — Defines the feature as the user running `./hello.sh` and the process exiting with code `0`.
- `.pi/skills/verify-hello-cli/SKILL.md:10-11` — Specifies a fresh `./hello.sh` run and that readiness occurs when the process exits.
- `.pi/skills/verify-hello-cli/SKILL.md:19-21` — Requires captured evidence in which `exit-code.txt` contains `0`.

## 3) Likely drift or none (with citations)

None apparent from source inspection. The implementation is a two-line script with no explicit failure path (`hello.sh:1-2`), and both the README and verification materials agree that `./hello.sh` exits `0` (`README.md:6-9`; `.pi/skills/verify-hello-cli/features/exit-zero.md:3`; `.pi/skills/verify-hello-cli/SKILL.md:19-21`). Live execution is still required to confirm the current executable bit and runtime result.

## 4) One live-verification recipe (commands for the coordinator to run later; do not run now)

```bash
cd /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave
test -x ./hello.sh && head -1 ./hello.sh && echo doctor-ok
mkdir -p .pi/evidence/verify-hello-cli
./hello.sh >.pi/evidence/verify-hello-cli/stdout.txt 2>.pi/evidence/verify-hello-cli/stderr.txt
echo $? >.pi/evidence/verify-hello-cli/exit-code.txt
test "$(cat .pi/evidence/verify-hello-cli/exit-code.txt)" = "0"
test "$(cat .pi/evidence/verify-hello-cli/stdout.txt)" = "HELLO-FAMILY-13"
test ! -s .pi/evidence/verify-hello-cli/stderr.txt
```
