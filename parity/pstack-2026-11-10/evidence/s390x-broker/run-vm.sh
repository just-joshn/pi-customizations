#!/bin/sh
# Usage: run-vm.sh <armv7|ppc64le|s390x|armv7-on-arm64> <work dir>
# Boots a real kernel for the architecture under full-system QEMU (TCG) inside the ro-arches-qemu container, with the
# ro-arches-<rootfs> image as its root disk and guest-init.sh as PID 1. Container-level emulation (binfmt qemu-user)
# cannot test seccomp: qemu-user refuses PR_SET_SECCOMP and the host kernel only ever sees arm64 syscalls.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
target=$1
work=$2
case "$target" in
  armv7) rootfs=armv7 kernel=armv7 qemu='qemu-system-arm -M virt -cpu cortex-a15 -m 1024' console=ttyAMA0 disk='-drive file=/disk.img,format=raw,if=none,id=d -device virtio-blk-device,drive=d' ;;
  armv7-on-arm64) rootfs=armv7 kernel=arm64 qemu='qemu-system-aarch64 -M virt -cpu cortex-a57 -m 2048' console=ttyAMA0 disk='-drive file=/disk.img,format=raw,if=none,id=d -device virtio-blk-device,drive=d' ;;
  ppc64le) rootfs=ppc64le kernel=ppc64le qemu='qemu-system-ppc64 -M pseries -cpu power9 -m 2048 -vga none' console=hvc0 disk='-drive file=/disk.img,format=raw,if=virtio' ;;
  s390x) rootfs=s390x kernel=s390x qemu='qemu-system-s390x -M s390-ccw-virtio -cpu max -m 2048' console=ttysclp0 disk='-drive file=/disk.img,format=raw,if=virtio' ;;
  *) echo "unknown target $target" >&2; exit 2 ;;
esac
trap 'docker rm -f "ro-arches-kernel-$target" "ro-arches-rootfs-$target" > /dev/null 2>&1; rm -rf "$work"' EXIT
rm -rf "$work"
mkdir -p "$work"
"$here/stage.sh" "$work/ro-check"
docker create --name "ro-arches-kernel-$target" "ro-arches-$kernel" true > /dev/null
docker cp -q "ro-arches-kernel-$target:/boot" "$work/boot"
docker create --name "ro-arches-rootfs-$target" "ro-arches-$rootfs" true > /dev/null
docker export "ro-arches-rootfs-$target" | docker run -i --rm --name "ro-arches-vm-$target" -v "$work:/work" ro-arches-qemu sh -c "
  set -eu
  mkdir /fs && tar -xpf - -C /fs && cp -a /work/ro-check /fs/ro-check
  mke2fs -q -t ext4 -d /fs /disk.img 3G
  rm -rf /fs
  kernel=\$(ls /work/boot/vmlinu* | head -1); initrd=\$(ls /work/boot/initrd.img-* | head -1)
  echo \"=== qemu: \$(${qemu%% *} --version | head -1); kernel \$kernel; initrd \$initrd\"
  exec timeout 3000 $qemu -smp 2 -nographic -nic none -no-reboot -kernel \$kernel -initrd \$initrd $disk \\
    -append 'root=/dev/vda ro init=/ro-check/guest-init.sh panic=-1 console=$console' < /dev/null
"
