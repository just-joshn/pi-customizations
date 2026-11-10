#!/bin/sh
# Boots the real s390x 6.12 kernel under full-system QEMU (ro-arches-qemu harness) and runs stage/checks.sh as uid 1000.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
work=/tmp/rv-s390x-work
trap 'docker rm -f ro-i2-rootfs >/dev/null 2>&1; rm -rf "$work"' EXIT
rm -rf "$work"; mkdir -p "$work"
cp -r "$here/stage" "$work/ro-check"
docker create --platform linux/s390x --name ro-i2-rootfs ro-arches-s390x true >/dev/null
docker cp -q ro-i2-rootfs:/boot "$work/boot"
docker export ro-i2-rootfs | docker run -i --rm -v "$work:/work" ro-arches-qemu sh -c '
  set -eu
  mkdir /fs && tar -xpf - -C /fs && cp -a /work/ro-check /fs/ro-check
  mke2fs -q -t ext4 -d /fs /disk.img 3G
  rm -rf /fs
  kernel=$(ls /work/boot/vmlinu* | head -1); initrd=$(ls /work/boot/initrd.img-* | head -1)
  exec timeout 1500 qemu-system-s390x -M s390-ccw-virtio -cpu max -m 2048 -smp 2 -nographic -nic none -no-reboot -kernel $kernel -initrd $initrd -drive file=/disk.img,format=raw,if=virtio -append "root=/dev/vda ro init=/ro-check/guest-init.sh panic=-1 console=ttysclp0" < /dev/null
'
