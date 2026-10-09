## Feature summary
`hello.sh` is a two-line POSIX shell script with no explicit `exit`. When the script ends, the process returns the status of its last command, `echo HELLO-FAMILY-13`. That `echo` returns 0 unless writing to stdout fails, so a normal run exits with code 0. The skill's Drive step writes `$?` to `exit-code.txt`, and its Evidence section expects that file to contain `0`.

## Source entry points
- `/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/hello.sh:1`: the `#!/bin/sh` shebang, so the script runs under `/bin/sh`.
- `/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/hello.sh:2`: `echo HELLO-FAMILY-13`. This is the only command and the last one, so its status (normally 0) becomes the exit code.
- `/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/.cursor/skills/verify-hello-cli/SKILL.md:26-28`: the Drive step creates the evidence directory, runs `./hello.sh` with stdout and stderr redirected to files, then runs `echo $? >.cursor/evidence/verify-hello-cli/exit-code.txt`.
- `/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/.cursor/skills/verify-hello-cli/SKILL.md:34`: the Evidence section expects `exit-code.txt` to contain `0`.
- `/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/README.md:11`: the README says the script "exits 0".

## Likely drift
none

There is one wording ambiguity, but it is not drift. `features/exit-zero.md:7` says to capture `exit-code.txt` "under the skill Evidence path". The Evidence section (`SKILL.md:30-34`) lists file names but no directory. The directory, `.cursor/evidence/verify-hello-cli/`, appears only in the Drive step (`SKILL.md:26-28`). The feature file, `SKILL.md` and the README all agree with `hello.sh` on exit code 0.

## Live-verification recipe
Run from the repo root:
```bash
mkdir -p .cursor/evidence/verify-hello-cli
./hello.sh >.cursor/evidence/verify-hello-cli/stdout.txt 2>.cursor/evidence/verify-hello-cli/stderr.txt
echo $? >.cursor/evidence/verify-hello-cli/exit-code.txt
cat .cursor/evidence/verify-hello-cli/exit-code.txt
```
Evidence file: `.cursor/evidence/verify-hello-cli/exit-code.txt`. Expected result: the file contains exactly `0` followed by a newline.
