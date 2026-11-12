import { spawnSync } from 'node:child_process';

export default function setup() {
  return () => {
    const socket = process.env['PSTACK_TMUX_SOCKET'];
    if (socket?.startsWith('pstack-test-')) spawnSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  };
}
