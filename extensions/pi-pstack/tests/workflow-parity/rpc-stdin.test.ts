import { spawn } from 'node:child_process';

import { expect, test } from 'vitest';
import { Rpc } from './lib/driver.ts';

test('a request to a pi whose stdin is already closed fails the request instead of crashing the run', async () => {
  const child = spawn('sh', ['-c', 'exec 0<&-; sleep 2'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = new Rpc(child, true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await expect(rpc.request({ type: 'get_state' }, 5_000)).rejects.toThrow(/stdin/);
  child.kill();
});
