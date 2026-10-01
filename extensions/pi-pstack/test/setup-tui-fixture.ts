import { stat, writeFile } from 'node:fs/promises';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { modelConfigPath, setupModels } from '../src/models.ts';

export default function setupFixture(pi: ExtensionAPI): void {
  pi.registerCommand('fixture-setup-cancel', {
    handler: async (_args, ctx) => {
      const output = process.env.PSTACK_TUI_ANSWERS;
      if (!output) throw new Error('Setup fixture requires an output path');
      const completed = await setupModels(ctx);
      const configurationExists = await stat(modelConfigPath()).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return false;
        },
      );
      await writeFile(output, JSON.stringify({ completed, configurationExists }), { mode: 0o600 });
    },
  });
}
