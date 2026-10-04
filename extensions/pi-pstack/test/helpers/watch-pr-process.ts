import { type SpawnOptions, spawn, spawnSync } from 'node:child_process';

const children = new Map<ReturnType<typeof spawn>, Promise<void>>();

export function runProcess(command: [string, ...string[]], options: SpawnOptions = {}) {
  const result = spawnSync(command[0], command.slice(1), { ...options, timeout: 30000 });
  if (result.error) throw result.error;
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function startProcess(command: [string, ...string[]], options: SpawnOptions = {}) {
  const child = spawn(command[0], command.slice(1), { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.resume();
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  // Attach rejection handling immediately, even if an assertion fails before the caller awaits.
  const settled = exited.then(
    () => {},
    () => {},
  );
  children.set(child, settled);
  return { pid: child.pid, exited, stdout: () => stdout, kill: (signal: NodeJS.Signals) => child.kill(signal) };
}

export async function stopProcesses(): Promise<void> {
  const pending = [...children];
  children.clear();
  for (const [child] of pending) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await Promise.all(
    pending.map(async ([child, settled]) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try {
        await settled;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
