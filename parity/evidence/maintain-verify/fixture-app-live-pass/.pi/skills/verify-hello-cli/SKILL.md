---
name: verify-hello-cli
description: Verify the hello-cli fixture via ./hello.sh (prints HELLO-FAMILY-13). Project-local verification skill with launch/drive and a feature map.
---

# verify-hello-cli

Tiny hello-cli fixture used for maintain-verify live-pass capture.

## Launch

Fresh run of `./hello.sh` from the repo root. No server. Ready when the process exits.

## Doctor

```bash
test -x ./hello.sh && head -1 ./hello.sh && echo doctor-ok
```

Expect `#!/bin/sh` and `doctor-ok`.

## Drive

```bash
mkdir -p .pi/evidence/verify-hello-cli
./hello.sh >.pi/evidence/verify-hello-cli/stdout.txt 2>.pi/evidence/verify-hello-cli/stderr.txt
echo $? >.pi/evidence/verify-hello-cli/exit-code.txt
```

## Evidence

- `stdout.txt` equals `HELLO-FAMILY-13` plus newline
- `stderr.txt` empty
- `exit-code.txt` contains `0`

## Cleanup

Do not kill by process name. Leave named evidence files in place.

## Helpers

None
