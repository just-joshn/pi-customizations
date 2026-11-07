#!/bin/sh
# Usage: run.sh <node-bin-dir> [<more node-bin-dirs>...]
# Packs extensions/pi-pstack, installs the archive into a fresh Pi profile through released Pi, and runs the
# installed extension and helpers with no Bun on PATH, once per Node directory given.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
pi=${PI_BIN:-$HOME/.pi/agent/bin/pi}
jar=${TLA2TOOLS:?set TLA2TOOLS to tla2tools.jar 1.7.4}
java_bin=${JAVA_BIN:?set JAVA_BIN to a directory holding java}
root=$(mktemp -d /tmp/pstack-installed-XXXXXX)
mkdir -p "$root/pack" "$root/home" "$root/work"
(cd "$repo/extensions/pi-pstack" && npm pack --silent --pack-destination "$root/pack" >/dev/null)
archive=$(ls "$root/pack"/*.tgz)
shasum -a 256 "$archive" | tee "$here/archive.sha256"
first=$1
cd "$root/work"
env -i HOME="$root/home" PI_CODING_AGENT_DIR="$root/agent" PATH="$first:/usr/bin:/bin" TERM=dumb "$pi" install "npm:@justjoshn/pi-pstack@file:$archive" > "$here/install.log" 2>&1
installed="$root/agent/npm/node_modules/@justjoshn/pi-pstack"
env -i HOME="$root/home" PI_CODING_AGENT_DIR="$root/agent" PATH="$first:/usr/bin:/bin" TERM=dumb PI_BIN="$pi" "$first/node" "$here/rpc.mjs" "$here/rpc.json"
cp -R "$installed/skills/statechart/scripts/test/corpus/Login" Login
for node_dir in "$@"; do
  version=$("$node_dir/node" --version)
  env -i PATH="$node_dir:/usr/bin:/bin" sh -c 'command -v bun' && { echo "bun is on PATH" >&2; exit 1; }
  env -i HOME="$root/home" PI_CODING_AGENT_DIR="$root/agent" PATH="$node_dir:$java_bin:/usr/bin:/bin" TLA2TOOLS="$jar" \
    "$installed/skills/statechart/scripts/statechart" Login/Login.tla --out "chart-$version" > "$here/statechart-$version.log" 2>&1
  env -i HOME="$root/home" PI_CODING_AGENT_DIR="$root/agent" PATH="$node_dir:/usr/bin:/bin" \
    "$installed/bin/pstack-routines-supervisor" --workspace "$root/work" > "$here/supervisor-$version.log" 2>&1 &
  pid=$!
  sleep 3
  kill -0 "$pid"
  kill "$pid"
  wait "$pid" || true
  if pgrep -f "pstack-routines-supervisor.mjs --workspace $root/work" >/dev/null; then echo "supervisor survived" >&2; exit 1; fi
  echo "$version: statechart $(tail -1 "$here/statechart-$version.log"), $(cat "$here/supervisor-$version.log")"
done
rm -rf "$root"
