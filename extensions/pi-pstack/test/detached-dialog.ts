import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function detachedDialog(pi: ExtensionAPI): void {
  pi.registerCommand('detached-confirm-fixture', {
    handler: async (_args, ctx) => {
      const approved = await ctx.ui.confirm('Confirm fixture action', 'Approve this fixture action?');
      pi.sendMessage({ customType: 'detached-confirm-result', content: approved ? 'approved' : 'denied', display: true, details: { approved } });
    },
  });
}
