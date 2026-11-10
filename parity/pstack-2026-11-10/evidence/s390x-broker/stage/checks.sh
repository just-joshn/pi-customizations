#!/bin/sh
export PATH=/opt/node/bin:/usr/sbin:/usr/bin:/sbin:/bin
echo "=== kernel: $(uname -srm)"; echo "=== node: $(node -p 'process.arch + " " + process.version')"; echo "=== libc: $(ldd --version 2>&1 | head -1)"; echo "=== bwrap: $(bwrap --version)"
echo "=== yama: $(cat /proc/sys/kernel/yama/ptrace_scope 2>&1)"
chmod 755 /ro-check/dist/netbroker-s390x /ro-check/race
echo "##### production chain, broker present"
setpriv --reuid=1000 --regid=1000 --init-groups env HOME=/home/pi node /ro-check/prod.mjs /ro-check/src/linux-readonly-sandbox.ts brokered
echo "##### broker missing: degraded profile still runs"
setpriv --reuid=1000 --regid=1000 --init-groups env HOME=/home/pi node /ro-check/prod.mjs /ro-check/degraded/src/linux-readonly-sandbox.ts degraded
