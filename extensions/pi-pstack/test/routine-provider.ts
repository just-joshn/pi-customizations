import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import journeyProvider from './journey-provider.ts';

export default function routineProvider(pi: ExtensionAPI): void {
  journeyProvider(pi);
  pi.on('before_agent_start', async (_event, ctx) => {
    const session = ctx.sessionManager.getSessionFile();
    if (!session) throw new Error('Routine fixture requires a persistent session.');
    const routine = dirname(dirname(session));
    const probe = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
        return 'allowed';
      } catch {
        return 'denied';
      }
    };
    const read = await probe(() => readFile(join(routine, 'secrets', 'sender-key')));
    const write = await probe(() => writeFile(join(routine, 'unauthorized-state.json'), 'tampered'));
    await writeFile(join(ctx.cwd, 'isolation-probe.json'), JSON.stringify({ read, write }));
  });
}
