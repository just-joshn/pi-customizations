// Container families start real containers on the local engine. Several test files run at once, and each family starts
// up to four containers, so a cross-process lock lets one container family run at a time. A machine already loaded by
// other work can then still start every worker inside Pi's startup deadline.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK = join(tmpdir(), 'pstack-workflow-parity-container.lock');
const STALE_MS = 20 * 60_000;

/** True when a container engine answers `docker version`. Absence is reported by skipping, never passed. */
export function engineAvailable(): boolean {
  const env = { ...process.env };
  if (env['DOCKER_HOST'] === undefined) {
    const host = spawnSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).stdout.trim();
    if (host !== '') env['DOCKER_HOST'] = host;
  }
  return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { env, encoding: 'utf8', timeout: 20_000 }).status === 0;
}

export async function withContainerLock<T>(use: () => Promise<T>): Promise<T> {
  const give = Date.now() + 25 * 60_000;
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) rmSync(LOCK, { recursive: true, force: true });
      } catch {
        // the holder released it between the two calls
      }
      if (Date.now() > give) throw new Error(`the container lock ${LOCK} was never released`);
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  try {
    return await use();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}
