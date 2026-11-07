#!/bin/sh
# Runs every check and writes its log under logs/. Build the images first:
#   docker build --platform linux/arm64 -t ro-arches-qemu -f qemu.Dockerfile .
#   ./build-rootfs.sh linux/arm64 arm64 linux-image-arm64 arm64
#   ./build-rootfs.sh linux/arm/v7 armv7 linux-image-armmp armv7l
#   ./build-rootfs.sh linux/ppc64le ppc64le linux-image-powerpc64le ppc64le
#   ./build-rootfs.sh linux/s390x s390x linux-image-s390x s390x
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
logs="$here/logs"
work="${TMPDIR:-/tmp}/ro-arches"
trap 'rm -rf "$work"' EXIT
mkdir -p "$logs" "$work"
"$here/stage.sh" "$work/stage"

timeout 600 docker run --rm --name ro-arches-arm64-native --privileged -v "$work/stage:/ro-check:ro" ro-arches-arm64 /ro-check/checks.sh > "$logs/container-arm64-native.txt" 2>&1
for arch in armv7 ppc64le s390x; do
  timeout 900 docker run --rm --name "ro-arches-qemu-user-$arch" --privileged -v "$work/stage:/ro-check:ro" "ro-arches-$arch" \
    sh -c 'printf "=== pid 1: %s\n" "$(tr "\000" " " < /proc/1/cmdline)"; /ro-check/checks.sh' > "$logs/container-$arch-qemu-user.txt" 2>&1
done
for target in s390x ppc64le armv7 armv7-on-arm64; do
  "$here/run-vm.sh" "$target" "$work/vm-$target" > "$logs/vm-$target.txt" 2>&1
done

deny_all="$work/deny-all-socketcall.ts"
sed 's/refusedWhen: \[\[359, AF_UNIX\], \[SOCKETCALL, SYS_SOCKET\]\], refused: \[IO_URING_SETUP\]/refusedWhen: [[359, AF_UNIX]], refused: [IO_URING_SETUP, SOCKETCALL]/' \
  "$repo/extensions/pi-pstack/src/linux-readonly-sandbox.ts" > "$deny_all"
grep -q 'refused: \[IO_URING_SETUP, SOCKETCALL\]' "$deny_all" || { echo 'the deny-all variant did not apply' >&2; exit 1; }
AFTER="$deny_all" "$here/run-vm.sh" s390x "$work/vm-s390x-deny-all" > "$logs/vm-s390x-deny-all-socketcall.txt" 2>&1

"$here/vitest-arm64.sh" > "$logs/vitest-arm64-native.txt" 2>&1
grep -H -E '^(RESULT|SANDBOX-REFUSED|=== (before|after) exit)|Tests ' "$logs"/*.txt
