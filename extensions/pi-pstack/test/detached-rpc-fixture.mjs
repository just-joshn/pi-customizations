import { join } from 'node:path';

import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';

const [directory, packageRoot] = process.argv.slice(2);
const handle = await startDetachedRpc({ directory, cwd: directory, agentDir: join(directory, 'agent'), args: ['--no-session', '--no-extensions', '-e', packageRoot] });
process.stdout.write(`${handle.directory}\n`);
process.exit(0);
