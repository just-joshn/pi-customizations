#!/bin/sh
# Runs the package's readonly-shell Vitest files at HEAD in a privileged native arm64 container, as root.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
tar="${TMPDIR:-/tmp}/ro-arches-repo.tar"
trap 'rm -f "$tar"' EXIT
git -C "$repo" archive --format=tar -o "$tar" HEAD
echo "=== commit $(git -C "$repo" rev-parse --short HEAD)"
timeout 1200 docker run --rm --name ro-arches-arm64-vitest --privileged -e NO_COLOR=1 -v "$tar:/repo.tar:ro" ro-arches-arm64 sh -c '
  set -e
  export PATH=/root/.bun/bin:/opt/node/bin:$PATH
  apt-get update -qq > /dev/null && apt-get install -y -qq --no-install-recommends unzip ripgrep socat > /dev/null
  curl -fsSL https://bun.sh/install | bash -s bun-v1.4.4 > /dev/null 2>&1
  mkdir /w && tar -xf /repo.tar -C /w && cd /w && bun install --frozen-lockfile > /dev/null
  cd extensions/pi-pstack
  echo "=== $(uname -srm), node $(node -v), bun $(bun -v), $(bwrap --version)"
  bunx vitest run test/linux-readonly-seccomp.test.ts test/linux-readonly-sandbox.test.ts test/linux-readonly-sandbox-missing.test.ts test/readonly-shell.test.ts test/readonly-shell-security.test.ts test/readonly-shell-dependency.test.ts
'
