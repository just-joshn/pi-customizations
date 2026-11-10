import { linuxReadonlyCommand } from './linux-readonly-sandbox.ts';
import { spawnSync } from 'node:child_process';
const cases = {
  'static go: socketpair, tcp': '/tmp/gotest /tmp/none.sock',
  'musl node: child pipe': `node -e "const r=require('node:child_process').spawnSync('echo',['pipe-ok'],{encoding:'utf8'});console.log(r.stdout.trim(),process.stdout.constructor.name)"`,
  'musl python: dgram socketpair': `python3 -c "import socket\ntry:\n socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)\n print('allowed')\nexcept OSError as e:\n print('refused', e.strerror)"`,
  'musl python: stream pair + asyncio': `python3 -c "import asyncio,socket; socket.socketpair(); asyncio.run(asyncio.sleep(0)); print('ok')"`,
  'musl curl loopback': 'curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:9; echo " rc=$?"',
  'musl git': 'git --version',
};
for (const [name, cmd] of Object.entries(cases)) { const r = spawnSync('/bin/bash', ['-c', linuxReadonlyCommand(cmd, '/tmp')], { encoding: 'utf8', timeout: 30000 }); console.log(name.padEnd(36), 'status', r.status, JSON.stringify((r.stdout + r.stderr).trim().slice(0, 110))); }
