import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { persistedWorkers } from './live-workers.ts';

export interface PaneIdentity {
  runId: string;
  workerId: string;
  session: string;
  pane: string;
  envPane: string;
  childPid: number;
}

export function paneCapture(repo: string, sandbox: string, socket: string): () => void {
  const seen = new Set<string>();
  const captured: PaneIdentity[] = [];
  return () => {
    for (const worker of persistedWorkers(repo)) {
      const { childPid, hostPid, tmuxSession, instance } = worker.state;
      if (typeof childPid !== 'number' || typeof hostPid !== 'number' || typeof tmuxSession !== 'string') continue;
      const key = `${worker.runId}/${worker.id}/${String(instance)}/${childPid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const panes = spawnSync('tmux', ['-L', socket, 'list-panes', '-a', '-F', '#{session_name} #{pane_pid} #{pane_id}'], { encoding: 'utf8' });
      const row = panes.stdout
        ?.split('\n')
        .map((line) => line.split(' '))
        .find(([session, pid]) => session === tmuxSession && pid === String(hostPid));
      const process = spawnSync('ps', ['eww', '-p', String(childPid), '-o', 'ppid=,command='], { encoding: 'utf8' });
      const parent = /^\s*(\d+)\s/.exec(process.stdout ?? '')?.[1];
      const envPane = /(?:^|\s)TMUX_PANE=(%\d+)(?:\s|$)/.exec(process.stdout ?? '')?.[1];
      if (panes.status !== 0 || process.status !== 0 || parent !== String(hostPid) || row?.[2] === undefined || envPane === undefined) continue;
      captured.push({ runId: worker.runId, workerId: worker.id, session: tmuxSession, pane: row[2], envPane, childPid });
      writeFileSync(join(sandbox, 'worker-pane-identities.json'), `${JSON.stringify(captured, null, 2)}\n`);
    }
  };
}
