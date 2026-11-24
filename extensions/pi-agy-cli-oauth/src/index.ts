import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { cliEnvironment, createAgyProvider, probeInstallation } from './provider.ts';

export default function agyCliExtension(pi: ExtensionAPI): void {
  pi.registerProvider(createAgyProvider());

  pi.registerCommand('antigravity-status', {
    description: 'Check the Antigravity CLI installation, sign-in, and model catalog',
    handler: async (_args, ctx) => {
      const result = await probeInstallation(cliEnvironment(), { force: true });
      if (!result.available || result.discovery === undefined) {
        ctx.ui.notify(result.detail ?? 'The Antigravity CLI is not ready', 'error');
        return;
      }
      const plan = result.discovery.tierName === undefined ? 'no plan reported' : result.discovery.tierName;
      const models = result.discovery.models.length;
      ctx.ui.notify(`Antigravity CLI ${result.discovery.version} is installed and signed in (${plan}, ${models} models)`, 'info');
    },
  });
}

export { createAgyProvider } from './provider.ts';
export { streamAgy } from './stream.ts';
