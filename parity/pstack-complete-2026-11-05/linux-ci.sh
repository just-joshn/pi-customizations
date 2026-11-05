#!/usr/bin/env bash
# Runs pi-pstack's vitest suite (or the files named) in a container that mirrors the `verify` job in
# .github/workflows/pi-pstack.yml: Ubuntu 24.04, Node 26.13.0, Bun 1.4.2, setuid bubblewrap, jq as on the hosted
# runner image, a non-root user, and a git checkout. The working tree is copied in (tracked and untracked files, not
# ignored ones) and committed there, so uncommitted edits are tested.
# Usage: linux-ci.sh <seconds> [vitest args...]   Exit 124 means the run outlived <seconds>.
set -euo pipefail

limit=${1:?usage: linux-ci.sh <seconds> [vitest args...]}
shift
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
image=pi-pstack-linux-ci

docker build -q -t "$image" - >/dev/null <<'DOCKERFILE'
FROM ubuntu:24.04
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap socat ripgrep git curl ca-certificates xz-utils unzip procps libatomic1 jq \
 && rm -rf /var/lib/apt/lists/* && chmod u+s "$(command -v bwrap)"
RUN node_arch=$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64) \
 && curl -fsSL "https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-$node_arch.tar.xz" | tar -xJ -C /usr/local --strip-components=1
RUN bun_arch=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x64) \
 && curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-$bun_arch.zip" \
 && unzip -q /tmp/bun.zip -d /tmp && mv "/tmp/bun-linux-$bun_arch/bun" /usr/local/bin/bun && rm -rf /tmp/bun*
RUN useradd -m runner
USER runner
DOCKERFILE

cd "$root"
git ls-files -z --cached --others --exclude-standard | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf - |
  docker run -i --rm --privileged "$image" bash -c '
    set -euo pipefail
    mkdir -p ~/work && tar -xf - -C ~/work && cd ~/work
    git init -q && git add -A && git -c user.email=ci@localhost -c user.name=ci commit -qm snapshot
    bwrap --ro-bind / / --unshare-net true
    bun install --frozen-lockfile >/dev/null
    cd extensions/pi-pstack
    timeout --kill-after=5 "$0" ./node_modules/.bin/vitest run "$@"
  ' "$limit" "$@"
