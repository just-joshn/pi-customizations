#!/bin/sh
# Usage: run-linux.sh [image] [platform]
# Packs extensions/pi-pstack, then inside a Linux container installs released Pi 1.5.0 from npm, installs the
# archive through `pi install`, and drives the installed extension and helpers with no Bun present.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
image=${1:-node:22.22.2-bookworm}
platform=${2:-linux/arm64}
jar=${TLA2TOOLS:?set TLA2TOOLS to tla2tools.jar 1.7.4}
work=$(mktemp -d /tmp/pstack-linux-XXXXXX)
(cd "$repo/extensions/pi-pstack" && npm pack --silent --pack-destination "$work" >/dev/null)
cp "$jar" "$work/tla2tools.jar"
cp "$here/rpc.mjs" "$work/rpc.mjs"
tag=$(echo "$image-$platform" | tr ':/' '--')
docker run --rm --platform "$platform" -v "$work:/in" "$image" sh -euc '
  if command -v apk >/dev/null; then apk add -q openjdk21-jre-headless; else apt-get update -qq >/dev/null && apt-get install -y -qq default-jre-headless >/dev/null; fi
  npm install -g --silent @earendil-works/pi-coding-agent@1.5.0
  export HOME=/root PI_CODING_AGENT_DIR=/root/agent TERM=dumb
  command -v bun && { echo "bun is present" >&2; exit 1; }
  uname -m; node --version; pi --version
  mkdir -p /work && cd /work
  pi install "npm:@justjoshn/pi-pstack@file:$(ls /in/*.tgz)"
  installed=/root/agent/npm/node_modules/@justjoshn/pi-pstack
  PI_BIN=pi node /in/rpc.mjs /in/rpc.json
  cp -R "$installed/skills/statechart/scripts/test/corpus/Login" Login
  TLA2TOOLS=/in/tla2tools.jar "$installed/skills/statechart/scripts/statechart" Login/Login.tla --out chart | tail -3
  "$installed/bin/pstack-routines-supervisor" --workspace /work > /in/supervisor.log 2>&1 &
  pid=$!
  sleep 3
  kill -0 "$pid"
  kill "$pid"
  wait "$pid" || true
  cat /in/supervisor.log
' > "$here/linux-$tag.log" 2>&1
cp "$work/rpc.json" "$here/linux-$tag-rpc.json"
tail -8 "$here/linux-$tag.log"
rm -rf "$work"
