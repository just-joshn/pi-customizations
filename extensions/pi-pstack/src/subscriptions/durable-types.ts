export type Target = { scope: 'pr'; prUrl: string } | { scope: 'repo'; repo: string } | { scope: 'author'; author: string; repo: string };
export type RunModel = { provider: string; id: string; thinking?: string };
/** What the durable store did with an event. `full` leaves every accepted event untouched so the sender can retry. */
export type EventAdmission = 'accepted' | 'duplicate' | 'inactive' | 'full';
export type Config =
  | { kind: 'github'; target: Target }
  | {
      kind: 'timer';
      prompt: string;
      cron?: string;
      delaySeconds?: number;
      once: boolean;
      strategy: 'wake_self' | 'new_session';
      /** The owner's model when it created the timer, reused by a live or detached new_session fire. */
      model?: RunModel;
      /** The owner's project-trust decision when it created the timer. */
      trusted?: boolean;
      /** cloud: each new_session fire runs on its own cloud machine with a fresh clone, as a Cursor automation does. */
      environment?: 'cloud';
    }
  | {
      kind: 'slack';
      /** The channel ID the trigger reads; a new top-level message there fires it. */
      channel: string;
      prompt: string;
      /** An RE2 pattern a message must match; with one, thread replies fire it too, as in Cursor's Slack trigger. */
      filter?: string;
      strategy: 'wake_self' | 'new_session';
      model?: RunModel;
      trusted?: boolean;
      environment?: 'cloud';
    }
  | {
      kind: 'webhook';
      prompt: string;
      slug: string;
      /** Absent in records written before webhook routines could run detached, which means wake_self. */
      strategy?: 'wake_self' | 'new_session';
      /** The owner's model when it created a detached routine, reused by every fire. */
      model?: RunModel;
      /** The owner's project-trust decision when it created a detached routine. */
      trusted?: boolean;
      environment?: 'cloud';
    };

/** `expiresAt` of 0 means the subscription does not expire, as Cursor Automations do not. */
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
  /** The owner lease token whose Pi process was handed this wake; it stays pending until that session persists it. */
  deliveredTo?: string;
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
