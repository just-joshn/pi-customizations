export type Target = { scope: 'pr'; prUrl: string } | { scope: 'repo'; repo: string } | { scope: 'author'; author: string; repo: string };
export type Config = { kind: 'github'; target: Target } | { kind: 'timer'; prompt: string; cron?: string; delaySeconds?: number; once: boolean; strategy: 'wake_self' | 'new_session' } | { kind: 'webhook'; prompt: string; slug: string };

export type Subscription = { id: string; name: string; createdAt: number; expiresAt: number; config: Config };
export type DurableSubscription = Subscription & {
  ownerSessionId?: string;
  ownerSessionFile?: string;
  /** Read only during v1 migration. Delivery is determined by config, never this flag. */
  detachedDelivery?: 'spawn' | 'park';
};
export type Note = { at: number; text: string };
export type StoredSubscription = DurableSubscription & {
  revision: number;
  lifecycle: 'active' | 'completed' | 'cancelled' | 'expired';
  lastOccurrence?: string;
  lastEvent?: Note;
  lastError?: Note;
  lastOutcome?: Note;
};
export type PendingEvent = {
  id: string;
  subscriptionId: string;
  acceptedAt: number;
  content: string;
  claim?: { pid: number; token: string; mode: 'live' | 'detached' };
  attempts?: number;
  retryAt?: number;
};
export type DurableRegistry = {
  version: 2;
  workspaceCwd: string;
  revision: number;
  subscriptions: StoredSubscription[];
  pending: PendingEvent[];
};
export type SupervisorLock = { pid: number; startedAt: number; epoch: string };
export type ArmStatus = {
  subscriptionId: string;
  revision: number;
  epoch: string;
} & ({ state: 'ready'; url?: string } | { state: 'error'; message: string });
