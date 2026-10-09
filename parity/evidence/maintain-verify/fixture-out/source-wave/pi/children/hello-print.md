## 1) Feature summary

`hello.sh` is an executable POSIX shell script. When run from the fixture root as `./hello.sh`, it executes `echo HELLO-FAMILY-13`, writing `HELLO-FAMILY-13` followed by a newline to stdout and then exits successfully. The feature definition specifies this same expected behavior. (`hello.sh:1-2`; `.pi/skills/verify-hello-cli/features/hello-print.md:1-4`)

## 2) Source entry points (file:line)

- `hello.sh:1` — declares the `/bin/sh` interpreter.
- `hello.sh:2` — prints `HELLO-FAMILY-13` to stdout.
- `README.md:5-10` — documents running `./hello.sh`, the expected output, and exit status 0.
- `.pi/skills/verify-hello-cli/SKILL.md:7-9` — defines the launch procedure as running `./hello.sh` from the repository root.
- `.pi/skills/verify-hello-cli/SKILL.md:21-24` — defines expected evidence: stdout with a newline, empty stderr, and exit code `0`.

## 3) Likely drift or none (with citations)

No source-level drift found. The implementation prints exactly `HELLO-FAMILY-13` (`hello.sh:2`), matching the feature statement (`.pi/skills/verify-hello-cli/features/hello-print.md:3`) and README documentation (`README.md:9`). The documented successful exit status is also consistent with the script having no failing command (`README.md:10`; `.pi/skills/verify-hello-cli/SKILL.md:21-24`). Live behavior was not executed.

## 4) One live-verification recipe (commands for the coordinator to run later; you must not run them)

```bash
cd /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave
test -x ./hello.sh && head -1 ./hello.sh && echo doctor-ok
mkdir -p .pi/evidence/verify-hello-cli
./hello.sh >.pi/evidence/verify-hello-cli/stdout.txt 2>.pi/evidence/verify-hello-cli/stderr.txt
echo $? >.pi/evidence/verify-hello-cli/exit-code.txt
cat .pi/evidence/verify-hello-cli/stdout.txt
cat .pi/evidence/verify-hello-cli/stderr.txt
cat .pi/evidence/verify-hello-cli/exit-code.txt
```

Expected results: stdout is `HELLO-FAMILY-13` plus a newline, stderr is empty, and the exit-code file contains `0` (`.pi/skills/verify-hello-cli/SKILL.md:11-15,21-24`).
