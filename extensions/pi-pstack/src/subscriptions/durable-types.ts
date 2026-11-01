import type { Subscription } from './index.ts';

/** On-disk desired state. version bumps only on breaking field changes. */
export type DurableRegistry = {
  version: 1;
  workspaceCwd: string;
  /** Same bodies as session SubscriptionSchema / wellFormed() today. */
  subscriptions: DurableSubscription[];
};

export type DurableSubscription = {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  config: Subscription['config'];
  /** Creating chat's session file, used only when parking wake_self events. */
  ownerSessionFile?: string;
  /** Detached fire: spawn a headless Pi, or park under runtime/inbox/ for interactive drain. */
  detachedDelivery?: 'spawn' | 'park';
};

export type DeliveryLedger = {
  subscriptionId: string;
  /** Last successfully claimed fire key. */
  lastClaimKey: string;
  lastClaimAt: number;
  lastError?: { at: number; text: string };
};

export type SupervisorLock = {
  pid: number;
  startedAt: number;
};
