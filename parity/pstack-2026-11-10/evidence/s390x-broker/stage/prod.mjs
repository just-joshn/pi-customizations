import { execFile, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
const [, , modulePath, expected] = process.argv;
const { linuxReadonlyCommand, linuxReadonlyProfile } = await import(modulePath);
const exec = promisify(execFile);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`); if (!ok) failures++; };
const sandboxed = async (command) => { try { const r = await exec('/bin/bash', ['-c', linuxReadonlyCommand(command, '/tmp')], { encoding: 'utf8', timeout: 60000 }); return (r.stdout + r.stderr).trim(); } catch (e) { return `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || String(e.message); } };

check(`profile is ${expected}`, linuxReadonlyProfile() === expected, linuxReadonlyProfile());
const tcp = createServer((c) => c.end('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nHELLO')).listen(0, '127.0.0.1');
await new Promise((r) => tcp.once('listening', r));
const port = tcp.address().port;
const dir = mkdtempSync('/tmp/ro-host-');
const sock = `${dir}/host.sock`;
writeFileSync(`${dir}/svc.py`, `import socket, sys\ns = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); s.bind('${sock}'); s.settimeout(40)\nopen('${dir}/ready','w').write('1')\nwith open('${dir}/log','w') as f:\n  try:\n    while True: f.write(s.recv(100).decode()+'\\n'); f.flush()\n  except Exception: pass\n`);
const svc = spawn('python3', [`${dir}/svc.py`], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

let n = 0;
const py = (code) => { const file = `${dir}/probe${n++}.py`; writeFileSync(file, code); return `python3 ${file}`; };
if (expected === 'brokered') {
  let out = await sandboxed(py(`import socket\ns=socket.create_connection(('127.0.0.1',${port}),3)\nprint('glibc-tcp', s.recv(200))`));
  check('glibc TCP to host loopback', out.includes('glibc-tcp') && out.includes('HELLO'), out.slice(0, 80));
  out = await sandboxed(py(`import socket\nfor name, args in [('unix-stream', (socket.AF_UNIX, socket.SOCK_STREAM)), ('unix-dgram', (socket.AF_UNIX, socket.SOCK_DGRAM))]:\n  try:\n    socket.socket(*args); print(name, 'created')\n  except OSError as e: print(name, e.strerror)`));
  check('glibc AF_UNIX socket refused', out.includes('unix-stream Operation not permitted') && out.includes('unix-dgram Operation not permitted'), out);
  out = await sandboxed(py(`import socket\nfor name, t in [('dgram', socket.SOCK_DGRAM), ('seqpacket', socket.SOCK_SEQPACKET), ('stream', socket.SOCK_STREAM)]:\n  try:\n    a,b=socket.socketpair(socket.AF_UNIX, t)\n    if t != socket.SOCK_STREAM: a.sendto(b'PAIR', '${sock}')\n    print(name, 'ok')\n  except OSError as e: print(name, e.strerror)`));
  check('glibc socketpair: stream ok, dgram and seqpacket refused', out.includes('dgram Operation not permitted') && out.includes('seqpacket Operation not permitted') && out.includes('stream ok'), out);
  out = await sandboxed(py(`import asyncio; asyncio.run(asyncio.sleep(0)); print('asyncio-ok')`));
  check('python asyncio works', out.includes('asyncio-ok'), out);
  out = await sandboxed(`node -e "const r=require('node:child_process').spawnSync('echo',['pipe-ok'],{encoding:'utf8'});console.log(r.stdout.trim(),process.stdout.constructor.name);fetch('http://127.0.0.1:${port}').then(r=>r.text()).then(t=>console.log('fetch',t))"`);
  check('node child_process, stdout Socket, fetch loopback', out.includes('pipe-ok Socket') && out.includes('fetch HELLO'), out);
  out = await sandboxed(`node -e "const c=require('node:child_process').fork('-e',['process.send(1);process.exit(0)'],{execArgv:[]});c.on('message',m=>console.log('ipc',m))"`);
  check('node fork IPC', out.includes('ipc 1'), out);
  out = await sandboxed('touch /tmp/should-not-exist 2>&1; echo done');
  check('writes still refused', out.includes('Read-only file system'), out);
  out = await sandboxed('/ro-check/race 20000');
  check('20,000 argument-flip races each for socket and socketpair produced no escape', /ESCAPES\(AF_UNIX returned\)=0/.test(out) && /ESCAPES\(non-stream AF_UNIX pair\)=0/.test(out), out.replaceAll('\n', ' | '));
  // abort: kill the outer process group mid-command and look for leftovers
  const child = spawn('/bin/bash', ['-c', linuxReadonlyCommand('sleep 40', '/tmp')], { detached: true, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  process.kill(-child.pid, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 2500));
  const left = spawnSync('sh', ['-c', "for p in /proc/[0-9]*; do c=$(cat $p/comm 2>/dev/null); case $c in netbroker*|bwrap|sleep) echo $c;; esac; done"], { encoding: 'utf8' }).stdout.trim();
  check('abort leaves no broker, bwrap or command behind', left === '', left || 'clean');
} else {
  const out = await sandboxed('echo degraded-ok; git --version | head -1');
  check('command runs without the broker', out.includes('degraded-ok'), out);
  const dgram = await sandboxed(py(`import socket\ntry:\n  socket.socket(socket.AF_UNIX); print('created')\nexcept OSError as e: print(e.strerror)`));
  check('AF_UNIX socket still refused without the broker', dgram.includes('Operation not permitted') || dgram.includes('created') === false, dgram);
}
let log = ''; try { log = readFileSync(`${dir}/log`, 'utf8'); } catch {}
if (expected === 'brokered') check('host Unix datagram service received nothing', log === '', JSON.stringify(log));
svc.kill(); tcp.close();
console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL ${failures}`);
process.exit(failures === 0 ? 0 : 1);
