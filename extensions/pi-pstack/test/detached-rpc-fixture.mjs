import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';

const [directory, packageRoot, mode] = process.argv.slice(2);
const handle = await startDetachedRpc({
  directory,
  cwd: directory,
  agentDir: join(directory, 'agent'),
  headless: mode === 'snapshot',
  closeAfterSettle: mode === 'snapshot',
  args: ['--no-session', '--no-extensions', '-e', packageRoot, ...(mode === 'snapshot' ? ['-e', join(packageRoot, 'test/journey-provider.ts'), '--provider', 'journey-test', '--model', 'recorder'] : [])],
});
let output = handle.directory;
if (mode === 'snapshot') {
  const identity = JSON.parse(await readFile(join(handle.directory, 'status.json'), 'utf8'));
  const accepted = await handle.send({ type: 'prompt', message: 'JOURNEY:goalcontinue' });
  if (!accepted.success) throw new Error(accepted.error);
  output = JSON.stringify({ directory: handle.directory, coordinatorPid: process.pid, supervisorPid: identity.pid, piPid: identity.childPid });
}
await new Promise((resolve, reject) => process.stdout.write(`${output}\n`, (error) => (error ? reject(error) : resolve())));
process.exit(0);
