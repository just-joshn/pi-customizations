#!/bin/sh
# Runs check.ts as uid 1000 against the sandbox module from main (before) and from the fix (after).
export PATH=/opt/node/bin:/usr/sbin:/usr/bin:/sbin:/bin
echo "=== kernel: $(uname -srm)"
echo "=== node: $(node -p 'process.arch + " " + process.version')"
echo "=== libc: $(ldd --version 2>&1 | head -1)"
echo "=== bwrap: $(bwrap --version)"
echo "=== kernel.io_uring_disabled=$(cat /proc/sys/kernel/io_uring_disabled 2>/dev/null)"
for phase in before after; do
  echo "=== $phase: node /ro-check/check.ts /ro-check/$phase/linux-readonly-sandbox.ts"
  setpriv --reuid=1000 --regid=1000 --init-groups env HOME=/home/pi node /ro-check/check.ts "/ro-check/$phase/linux-readonly-sandbox.ts"
  echo "=== $phase exit $?"
done
