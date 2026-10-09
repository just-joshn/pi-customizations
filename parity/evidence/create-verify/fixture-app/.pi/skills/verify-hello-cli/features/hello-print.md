# Hello print

The only feature: running the script prints a fixed greeting line.

## Sub-features

- Greeting line on stdout: `HELLO-FAMILY-13`.
- Clean exit with status 0 and nothing on stderr.

## How to get to it (user POV)

From the repo root, a user runs `./hello.sh`.

## Driving it with a plain shell

Follow the Drive section of `../SKILL.md`: run `./hello.sh`, redirecting stdout, stderr and the exit code into `.pi/evidence/verify-hello-cli/`. The end state that proves it works: stdout is exactly `HELLO-FAMILY-13\n`, stderr is empty, exit code is 0.

## Gotchas

- The script must be executable (`-rwxr-xr-x`); a missing exec bit gives "permission denied" with exit 126.
- Run from the repo root so the relative path resolves.
- The script ignores arguments and input.
