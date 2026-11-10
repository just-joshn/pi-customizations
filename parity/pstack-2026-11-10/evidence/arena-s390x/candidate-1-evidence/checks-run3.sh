#!/bin/sh
export PATH=/opt/node/bin:/usr/sbin:/usr/bin:/sbin:/bin
echo "=== kernel: $(uname -srm)"; echo "=== bwrap: $(bwrap --version)"
echo "=== yama: $(cat /proc/sys/kernel/yama/ptrace_scope 2>&1)"; echo "=== lsm: $(cat /sys/kernel/security/lsm 2>&1)"
as() { setpriv --reuid=1000 --regid=1000 --init-groups env HOME=/home/pi "$@"; }
D=/tmp/d; mkdir $D; chown 1000 $D; touch $D/server.log; chown 1000 $D/server.log
as python3 /ro-check/serve.py $D & sleep 3; PORT=$(cat $D/port)
H=/ro-check/netbroker-s390x; POL=socketcall=102,socket=1,socketpair=8,unix=1,stream=1,typemask=15
cp /ro-check/broker.bpf /tmp/broker.bpf; chmod 644 /tmp/broker.bpf
BW="bwrap --new-session --die-with-parent --unshare-all --share-net --ro-bind / / --dev /dev --proc /proc --cap-drop ALL"
box() { as sh -c 'exec 3</tmp/broker.bpf; exec "$@"' sh $H --policy $POL --filter-fd 3 -- $BW -- "$@"; }

procs() { for p in /proc/[0-9]*; do c=$(cat $p/comm 2>/dev/null); case $c in netbroker*|bwrap|sleep) echo "  pid $(basename $p) $c";; esac; done; }

hpid() { for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = netbroker-s390x ] && basename $p; done | head -1; }
echo "##### supervisor stopped (SIGSTOP) then continued"
as sh -c "exec 3</tmp/broker.bpf; exec $H --policy $POL --filter-fd 3 -- $BW -- python3 -c 'import socket,time;time.sleep(6);t=time.time();socket.socket();print(\"socket() took %.1fs\" % (time.time()-t))'" & SP=$!
sleep 3; HP=$(hpid); echo "helper pid $HP"; kill -STOP $HP; sleep 6; echo "stopped; command should now be blocked in socket()"; sleep 3; kill -CONT $HP; wait $SP; echo "exit=$?"
now() { cut -d' ' -f1 /proc/uptime; }
echo "##### startup cost (20 runs of true)"
t0=$(now); for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do as $BW -- true; done; t1=$(now)
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do box true; done; t2=$(now)
echo "bwrap alone: $t0 -> $t1 ; with helper: $t1 -> $t2"
echo "=== done"
