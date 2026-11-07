# Installed helpers on released Pi 1.5.0

Archive `justjoshn-pi-pstack-0.15.36-pi.20.tgz` packed from branch `fix/pstack-standalone-helpers`. SHA-256 `14a6a2ceb6a80af3ce735a89ea6dac855f878adbb2448f46684e62c91f134e75`, 671 files. `npm pack` ran the `prepack` freshness check with Bun 1.4.4.

Every command below ran with `env -i`, `HOME` and `PI_CODING_AGENT_DIR` under `/tmp/pstack-h12`, and `PATH` holding only a Node directory plus `/usr/bin:/bin`. No Bun was on that PATH, and no `PSTACK_*` variable was set.

1. `pi install npm:@justjoshn/pi-pstack@file:<archive>` with Pi 1.5.0 exited 0. It installed into the isolated profile's `npm/node_modules`.
2. `node rpc.mjs rpc.json` started `pi --mode rpc --no-session` in that profile. `get_commands` returned 88 commands: the 10 extension commands and 78 skills. `/mode poteto-mode` appended a `pstack/mode` entry and named the installed `SKILL.md` path. See `rpc.json`.
3. The installed `skills/statechart/scripts/statechart Login/Login.tla` checked the corpus model with real TLC 1.7.4. It reported `TypeOK, NoDeadlock` and exit 0 on Node 24.22.1 and on Node 22.19.0.
4. The installed `bin/pstack-routines-supervisor --workspace /tmp/pstack-h12/work` started on Node 24.22.1 (`supervisor.log`) and on Node 22.19.0 (`supervisor22.log`). It created the workspace's durable directory and left no process after SIGTERM.

Before this change, the published 0.15.36-pi.20 supervisor failed under the same PATH with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because Node does not strip types under `node_modules`.
