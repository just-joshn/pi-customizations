## Feature summary
`hello.sh` is a two-line POSIX shell script. Its shebang is `#!/bin/sh`, and it runs one unconditional `echo HELLO-FAMILY-13`. When the user runs `./hello.sh`, the script writes `HELLO-FAMILY-13` followed by a newline to stdout. It writes nothing to stderr and exits 0 because `echo` is the last command. It takes no arguments, environment variables, or config.

## Source entry points
- /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/hello.sh:1 — the `#!/bin/sh` shebang, which is what the SKILL.md Doctor step expects to see.
- /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/hello.sh:2 — `echo HELLO-FAMILY-13`, the only output and the feature itself.
- /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/evidence/maintain-verify/fixture-app-source-wave/README.md:7-11 — documents running `./hello.sh`, which prints `HELLO-FAMILY-13` and exits 0. This matches the source.

## Likely drift
none. The output string, the shebang and the exit-0 claim match the source in all of these places:
- `.cursor/skills/verify-hello-cli/features/hello-print.md:3`
- `.cursor/skills/verify-hello-cli/SKILL.md:3`, `:20` and `:32-34`
- `hello.sh:1-2`

A small gap in the docs: `hello-print.md:7` says "Capture stdout under the skill Evidence path" but gives no filename. `SKILL.md:26` fills that in as `.cursor/evidence/verify-hello-cli/stdout.txt`.

## Live-verification recipe
Run from the repo root:
```bash
test -x ./hello.sh && head -1 ./hello.sh && echo doctor-ok
mkdir -p .cursor/evidence/verify-hello-cli
./hello.sh >.cursor/evidence/verify-hello-cli/stdout.txt 2>.cursor/evidence/verify-hello-cli/stderr.txt
echo $? >.cursor/evidence/verify-hello-cli/exit-code.txt
printf 'HELLO-FAMILY-13\n' | cmp - .cursor/evidence/verify-hello-cli/stdout.txt && echo stdout-ok
```
- **Evidence file:** `.cursor/evidence/verify-hello-cli/stdout.txt`.
- **Expected:**
  - The doctor step prints `#!/bin/sh` and `doctor-ok`.
  - `stdout.txt` is exactly `HELLO-FAMILY-13` plus a newline, so `stdout-ok` prints.
  - `stderr.txt` is empty.
  - `exit-code.txt` contains `0`.
