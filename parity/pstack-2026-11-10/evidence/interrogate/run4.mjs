import { linuxReadonlyCommand } from './linux-readonly-sandbox.ts';
import { spawnSync } from 'node:child_process';
for (let i = 1; i <= 3; i++) {
  try { linuxReadonlyCommand('echo hi', '/tmp'); console.log(`call ${i}: ok`); }
  catch (e) { console.log(`call ${i}: THROWS ${e.message}`); }
  console.log(`  real bwrap works now:`, spawnSync('/usr/bin/bwrap', ['--unshare-all','--ro-bind','/','/','--dev','/dev','--proc','/proc','--','true']).status === 0);
}
