#!/bin/sh
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
echo "=== kernel: $(uname -srm)"
cat > /tmp/server.py <<'PY'
import socket, os
p='/tmp/hostsvc.sock'
s=socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); s.bind(p); os.chmod(p,0o777)
while True:
    d=s.recv(1000); open('/tmp/host-service.log','ab').write(d+b'\n')
PY
chmod 1777 /tmp
python3 /tmp/server.py &
sleep 2
cp /ro-check/probe.py /tmp/probe.py
echo "=== sandboxed probe (filter from worktree seccompFilter('s390x'))"
setpriv --reuid=1000 --regid=1000 --init-groups env HOME=/tmp bwrap --new-session --die-with-parent --unshare-all --share-net --ro-bind / / --dev /dev --proc /proc --cap-drop ALL --chdir /tmp --seccomp 3 python3 /tmp/probe.py 3< /ro-check/s390x.bpf
sleep 1
echo "=== host service log: $(cat /tmp/host-service.log 2>&1)"
