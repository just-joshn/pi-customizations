#!/bin/sh
# Which syscalls each libc uses to create and connect sockets, from qemu-user's syscall trace (QEMU_STRACE). qemu prints
# socketcall's subcalls in upper case (SOCKET, CONNECT) and the direct syscalls in lower case.
set -u
for arch in armv7 ppc64le s390x; do
  echo "=== glibc 2.41, Debian trixie, $arch: python3 socket(AF_UNIX), then node connecting to 127.0.0.1"
  timeout 600 docker run --rm --name "ro-arches-strace-$arch" -e QEMU_STRACE=1 "ro-arches-$arch" sh -c \
    'python3 -c "import socket; socket.socket(socket.AF_UNIX).close()"; /opt/node/bin/node -e "require(\"node:net\").createConnection(1, \"127.0.0.1\").on(\"error\", () => {})"' 2>&1 \
    | grep -E '^[0-9]+ (socket|SOCKET|socketcall|connect|CONNECT)\('
done
for platform in linux/arm/v7 linux/ppc64le linux/s390x; do
  echo "=== musl, alpine:3.20, $platform: busybox wget 127.0.0.1"
  timeout 600 docker run --rm --name ro-arches-strace-musl --platform "$platform" -e QEMU_STRACE=1 alpine:3.20 wget -q -T 2 http://127.0.0.1:1/ 2>&1 \
    | grep -E '^[0-9]+ (socket|SOCKET|socketcall|connect|CONNECT)\('
done
