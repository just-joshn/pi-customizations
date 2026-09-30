import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export type Deliver = (ctx: ExtensionContext, text: string) => Promise<void>;

type Waiter = { started: boolean; resolve: () => void };

export function createDelivery(pi: ExtensionAPI, startTimeoutMs = 60_000): Deliver {
  const waiters = new Set<Waiter>();
  pi.on('agent_start', () => {
    for (const waiter of waiters) waiter.started = true;
  });
  pi.on('agent_settled', () => {
    for (const waiter of waiters) if (waiter.started) waiter.resolve();
  });
  return async (ctx, text) => {
    if (ctx.hasUI) {
      pi.sendUserMessage(text, { deliverAs: 'followUp' });
      return;
    }
    // Print mode disposes the session when the command returns, so hold the command until the turn it queued settles.
    await new Promise<void>((resolve) => {
      const waiter: Waiter = {
        started: false,
        resolve: () => {
          clearTimeout(timer);
          waiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        if (!waiter.started) waiter.resolve();
      }, startTimeoutMs);
      waiters.add(waiter);
      pi.sendUserMessage(text, { deliverAs: 'followUp' });
    });
  };
}
