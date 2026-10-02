import { appendFileSync } from 'node:fs';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const ROUTER_PROVIDER = 'router';
export const ROUTER_MODEL = 'auto';
const ROUTED_PROVIDER = 'claude-subscription';
const ROUTED_MODEL = 'claude-sonnet-4-6';

export default function (pi: Pick<ExtensionAPI, 'on' | 'registerVirtualModel'>) {
  const log = process.env.REQUEST_EVENT_LOG;
  if (!log) throw new Error('REQUEST_EVENT_LOG is not set.');
  pi.registerVirtualModel({
    provider: ROUTER_PROVIDER,
    id: ROUTER_MODEL,
    name: 'Auto',
    route: (_request, ctx) => {
      const model = ctx.modelRegistry.find(ROUTED_PROVIDER, ROUTED_MODEL);
      if (!model) throw new Error(`${ROUTED_PROVIDER}/${ROUTED_MODEL} is not registered.`);
      return { model, thinkingLevel: 'off' };
    },
  });
  pi.on('before_provider_request', (_event, ctx) => {
    appendFileSync(log, `${ctx.model?.provider}\n`);
  });
}
