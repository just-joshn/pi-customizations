import { linuxReadonlyCommand } from './linux-readonly-sandbox.ts';
import { spawnSync } from 'node:child_process';
const cmd = linuxReadonlyCommand(`python3 -c "import socket; socket.socket(socket.AF_UNIX); print('AF_UNIX socket created')"; touch /tmp/x 2>&1`, '/tmp');
console.log('verification passed; command =', cmd.slice(0, 120) + '...');
const r = spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' });
console.log(r.status, r.stdout, r.stderr);
