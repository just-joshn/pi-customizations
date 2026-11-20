import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { z } from 'zod';

const SHIM_MODE = 0o755;
const STATE_ENV = 'FAKE_TMUX_STATE';
const PATH_ENV = 'PATH';

/**
 * A stand-in for the tmux binary. Each session runs its command as a plain background process, so the job wrapper still
 * runs for real. It keeps one pid file and one pane file per session under $FAKE_TMUX_STATE. Like tmux, kill-session
 * hangs the session up, has-session fails once the session's process is gone, and send-keys C-c interrupts it.
 */
const SHIM = `#!/bin/sh
state="\${${STATE_ENV}:?}"
sock=""
if [ "$1" = "-S" ]; then sock=$(basename "$2"); shift 2; fi
dir="$state/$sock"
mkdir -p "$dir"
sub="$1"; shift
session=""; cwd="."; target=""; keys=""
while [ $# -gt 0 ]; do
  case "$sub:$1" in
    new-session:-d) shift ;;
    new-session:-s) session="$2"; shift 2 ;;
    new-session:-c) cwd="$2"; shift 2 ;;
    new-session:*) break ;;
    *:-t) target=$(printf '%s' "$2" | sed 's/^=//'); shift 2 ;;
    *:-p) shift ;;
    *) keys="$1"; shift ;;
  esac
done
alive() { [ -f "$dir/$1.pid" ] && kill -0 "$(cat "$dir/$1.pid")" 2>/dev/null; }
case "$sub" in
  new-session)
    [ -n "$FAKE_TMUX_REFUSE" ] && exit 1
    (cd "$cwd" && exec "$@") > "$dir/$session.pane" 2>&1 < /dev/null &
    echo $! > "$dir/$session.pid" ;;
  has-session) alive "$target" ;;
  kill-session) alive "$target" && kill -HUP "$(cat "$dir/$target.pid")" ;;
  send-keys) alive "$target" && kill -TERM "$(cat "$dir/$target.pid")" ;;
  capture-pane) cat "$dir/$target.pane" ;;
  kill-server)
    for pidfile in "$dir"/*.pid; do
      [ -f "$pidfile" ] && kill -HUP "$(cat "$pidfile")" 2>/dev/null
    done
    exit 0 ;;
  *) exit 1 ;;
esac
`;

export type FakeTmux = {
  /** The environment variables that put the fake first on PATH and tell it where to keep its sessions. */
  env: Readonly<Record<string, string>>;
  stateDir: string;
};

/** Writes the fake tmux under `root` and returns the environment that makes Pi's child processes find it first. */
export function installFakeTmux(root: string): FakeTmux {
  const binDir = join(root, 'fake-tmux-bin');
  const stateDir = join(root, 'fake-tmux-state');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  const shim = join(binDir, 'tmux');
  writeFileSync(shim, SHIM);
  chmodSync(shim, SHIM_MODE);
  const path = z.string().parse(process.env[PATH_ENV]);
  return { env: { [PATH_ENV]: `${binDir}${delimiter}${path}`, [STATE_ENV]: stateDir }, stateDir };
}

const HANG_UP_ALL = 'kill -HUP $(cat "$0"/*/*.pid) 2>/dev/null; true';

/** Hangs up every session the fake started, as a tmux server dying would, so no job outlives its test. */
export function hangUpFakeTmux({ stateDir }: FakeTmux): void {
  spawnSync('sh', ['-c', HANG_UP_ALL, stateDir], { stdio: 'ignore' });
}
