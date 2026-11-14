import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { paneCapture } from './lib/pane-identity.ts';

test('host measurement reads the real child environment and tmux pane without a model command', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'host-pane-'));
  const socket = `pane-test-${process.pid}`;
  const worker = join(sandbox, 'repo/.pi/pstack/runs/run/workers/worker');
  mkdirSync(worker, { recursive: true });
  writeFileSync(join(worker, 'assignment.json'), '{}');
  const script = join(sandbox, 'host.cjs');
  writeFileSync(
    script,
    `const {spawn,spawnSync}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:process.env});child.once('spawn',()=>{fs.writeFileSync(${JSON.stringify(join(worker, 'state.json'))},JSON.stringify({hostPid:process.pid,childPid:child.pid,tmuxSession:'worker',instance:'test'}));spawnSync('tmux',['-L',${JSON.stringify(socket)},'wait-for','-S','ready']);});`,
  );
  try {
    execFileSync('tmux', ['-L', socket, 'new-session', '-d', '-s', 'worker', `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`]);
    execFileSync('tmux', ['-L', socket, 'wait-for', 'ready']);
    paneCapture(join(sandbox, 'repo'), sandbox, socket)();
    const rows = JSON.parse(readFileSync(join(sandbox, 'worker-pane-identities.json'), 'utf8')) as { pane: string; envPane: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pane).toMatch(/^%\d+$/);
    expect(rows[0]?.envPane).toBe(rows[0]?.pane);
  } finally {
    execFileSync('tmux', ['-L', socket, 'kill-server']);
    rmSync(sandbox, { recursive: true, force: true });
  }
});
