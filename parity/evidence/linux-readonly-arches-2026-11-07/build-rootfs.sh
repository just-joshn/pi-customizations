#!/bin/sh
# Usage: build-rootfs.sh <platform> <tag> <kernel package> <node arch>
set -eu
cd "$(dirname "$0")"
docker build --platform "$1" -t "ro-arches-$2" --build-arg "KERNEL=$3" --build-arg "NODE_ARCH=$4" -f rootfs.Dockerfile .
