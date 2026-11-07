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

This covers macOS arm64 only. Linux and the other targets in the support contract are not covered here.
