import { join } from 'node:path';

import { startTimerService, timerCommand } from '../scripts/timer-client.mjs';

const [directory, root, prompt = 'TIMER:survive', mode] = process.argv.slice(2);
const held = prompt.startsWith('TIMER:HOLD');
await startTimerService(directory, {
  cwd: directory,
  agentDir: join(directory, 'agent'),
  args: [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '-e',
    join(root, held ? 'test/timer-tool-provider.ts' : 'test/journey-provider.ts'),
    '--provider',
    held ? 'timer-test' : 'journey-test',
    '--model',
    'recorder',
    '--session-dir',
    join(directory, 'session'),
  ],
});
const receipt = await timerCommand(directory, { type: 'subscribe', timer: { name: 'survivor', prompt, delaySeconds: mode === 'deferred' ? 60 : 1, ...(mode === 'deferred' ? { runImmediately: false } : {}) } });
process.stdout.write(JSON.stringify(receipt));
