# Installed helpers on released Pi 1.5.0

`run.sh` packs `extensions/pi-pstack`, installs the archive into a fresh Pi profile with `pi install npm:@justjoshn/pi-pstack@file:<archive>`, and drives the installed copy. Every step runs under `env -i` with `HOME` and `PI_CODING_AGENT_DIR` in a temporary directory and a `PATH` of one Node directory plus `/usr/bin:/bin`. The script fails if Bun is on that PATH.

```sh
TLA2TOOLS=<tla2tools.jar 1.7.4> JAVA_BIN=<dir with java> \
  parity/evidence/installed-helpers-2026-11-06/run.sh <node 24 bin dir> <node 22.19.0 bin dir>
```

The recorded run at commit `f1de4697` used Pi 1.5.0 on macOS 27.2 arm64:

- `archive.sha256` holds the packed `0.15.36-pi.21` archive hash. `npm pack` ran the `prepack` freshness check with Bun 1.4.4.
- `install.log` shows Pi's install exiting 0.
- `rpc.json` comes from `pi --mode rpc --no-session` in that profile. `get_commands` lists 88 commands: the 10 extension commands and the 78 skills. `/mode poteto-mode` appends a `pstack/mode` entry and names the installed `SKILL.md`.
- `statechart-v24.22.1.log` and `statechart-v22.19.0.log` show the installed statechart script checking the Login corpus model with real TLC.
- `supervisor-v24.22.1.log` and `supervisor-v22.19.0.log` show the installed routines supervisor starting. It is gone after SIGTERM.

Before this change the published `0.15.36-pi.20` supervisor failed under the same PATH with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because Node does not strip types under `node_modules`.

`run-linux.sh <image> <platform>` repeats the run inside a container: it installs Pi 1.5.0 from npm, installs the archive with `pi install`, lists commands over RPC, checks the TLC model, and starts and stops the supervisor. No Bun is in these images. The recorded `linux-*.log` runs used OrbStack on this Mac:

| Image | Platform | libc | Result |
|---|---|---|---|
| `node:22.22.2-bookworm` | `linux/arm64` | glibc | 88 commands, TLC model holds, supervisor started |
| `node:22.22.2-bookworm` | `linux/amd64` (emulated) | glibc | same |
| `node:22.22.2-alpine` | `linux/arm64` | musl | same |
| `node:22.22.2-alpine` | `linux/amd64` (emulated) | musl | same |

The first Alpine run found that the supervisor launcher needed bash, which Alpine does not ship. The launcher is now a POSIX `sh` script.

These containers share the Mac's Linux VM kernel. They do not cover armv7, ppc64le, s390x, a native x64 kernel, or minimum macOS versions.
