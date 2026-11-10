#!/bin/sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$1"
cp -R "$here/stage/." "$1/"
cp "$here/guest-init.sh" "$1/"
