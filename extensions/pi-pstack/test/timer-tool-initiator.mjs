import { join } from 'node:path';

import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';

const [directory, root] = process.argv.slice(2);
const handle = await startDetachedRpc({
  directory,
  cwd: directory,
  agentDir: join(directory, 'agent'),
  headless: true,
  args: [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '-e',
    join(root, 'src/index.ts'),
    '-e',
    join(root, 'test/timer-tool-provider.ts'),
    '--provider',
    'timer-test',
    '--model',
    'recorder',
    '--session-dir',
    join(directory, 'initiating-session'),
  ],
});
try {
  const response = await handle.send({ type: 'prompt', message: 'START_TIMER' });
  if (!response.success) throw new Error(response.error);
  const deadline = Date.now() + 20000;
  while ((await handle.activity()).kind !== 'settled') {
    if (Date.now() >= deadline) throw new Error('Timer tool did not settle.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const result = await handle.send({ type: 'get_entries' });
  if (!result.success) throw new Error(result.error);
  const tool = result.data.entries.find((entry) => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'SubscribeTimer')?.message;
  if (!tool || tool.isError) throw new Error(JSON.stringify(tool));
  process.stdout.write(JSON.stringify(tool.details));
} finally {
  await handle.close();
}
