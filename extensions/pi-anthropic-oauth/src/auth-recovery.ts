import type { CredentialStore, FetchFunction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { REFRESH_TIMEOUT_MS } from './refresh-claim.ts';
import { createRefreshLatch } from './refresh-latch.ts';
import { type StoredCredential, sameStored } from './stored-credential.ts';

export type AuthRecovery = {
  bindCredentials(store: CredentialStore): void;
  remember(credential: OAuthCredential, rotation?: CredentialRotation): void;
  forget(): void;
  wrapFetch(base: FetchFunction): FetchFunction;
};

export type CredentialRotation = { readonly replaced: OAuthCredential };

type RequestHeaders = NonNullable<NonNullable<Parameters<FetchFunction>[1]>['headers']>;

function bearerAccess(headers: RequestHeaders | undefined): string | undefined {
  if (headers === undefined) return undefined;
  const value = new Headers(headers).get('authorization');
  if (value === null) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(value);
  return match?.[1];
}

function withBearer(headers: RequestHeaders | undefined, access: string): Headers {
  const next = new Headers(headers);
  next.set('authorization', `Bearer ${access}`);
  return next;
}

const REVOKED_OAUTH_TOKEN = /OAuth (?:access )?token has been revoked/;

async function isAuthRecoveryTrigger(response: Response): Promise<boolean> {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  try {
    return REVOKED_OAUTH_TOKEN.test(await response.clone().text());
  } catch {
    return false;
  }
}

/**
 * One login's tokens: the newest, and the ones it replaced. A logout or another login replaces the whole object,
 * so a refresh that captured the old object can tell it no longer belongs to the current login.
 */
type Lineage = { latest: OAuthCredential; readonly replaced: Set<string> };

/** What a request was sent against, for a host this provider sees only through `stored`. */
type SentWith = { readonly stored: StoredCredential; readonly latest: OAuthCredential | undefined };

/**
 * `recorded` returns the newest successor the rotation log records for a credential, or the credential itself.
 * `stored` reads what the host has stored. Without a bound store, a logout or another login reaches this provider only
 * at the next auth resolution, so a recovery gives up when the stored credential changed to one of those after the request was sent.
 */
export function createAuthRecovery(input: { providerId: string; oauth: Pick<OAuthAuth, 'refresh'>; recorded: (credential: OAuthCredential) => Promise<OAuthCredential>; stored: () => StoredCredential }): AuthRecovery {
  let store: CredentialStore | undefined;
  let lineage: Lineage | undefined;
  const latch = createRefreshLatch<string | undefined>();

  const issued = (access: string): boolean => lineage !== undefined && (lineage.latest.access === access || lineage.replaced.has(access));

  async function continues(from: OAuthCredential | undefined, stored: OAuthCredential): Promise<boolean> {
    if (issued(stored.access)) return true;
    return from !== undefined && (await input.recorded(from)).access === stored.access;
  }

  function adopt(captured: Lineage, failedAccess: string, next: OAuthCredential | undefined): string | undefined {
    if (!next || lineage !== captured) return undefined;
    if (next.access !== failedAccess) captured.replaced.add(failedAccess);
    captured.latest = next;
    return next.access;
  }

  async function refreshStored({ bound, captured, failedAccess, signal }: { bound: CredentialStore; captured: Lineage; failedAccess: string; signal: AbortSignal }): Promise<string | undefined> {
    const from = captured.latest;
    let next: OAuthCredential | undefined;
    // modify resolves to the stored credential even when the callback declines, so the callback decides what is sent.
    await bound.modify(
      input.providerId,
      async (current) => {
        if (current?.type !== 'oauth') return undefined;
        if (current.access === failedAccess) {
          next = await input.oauth.refresh(current, AbortSignal.timeout(REFRESH_TIMEOUT_MS));
          return next;
        }
        // Another refresh already replaced the token, or another login did. Only the first continues this lineage.
        if (await continues(from, current)) next = current;
        return undefined;
      },
      { signal },
    );
    return adopt(captured, failedAccess, next);
  }

  async function refreshLatest(captured: Lineage, failedAccess: string): Promise<string | undefined> {
    const current = captured.latest;
    if (current.access !== failedAccess) return current.access;
    return adopt(captured, failedAccess, await input.oauth.refresh(current, AbortSignal.timeout(REFRESH_TIMEOUT_MS)));
  }

  // The host's store may never hold this login (an SDK host with its own store), so only a change since the request was sent counts.
  async function storeStillAgrees(sent: SentWith): Promise<boolean> {
    const now = input.stored();
    if (sameStored(sent.stored, now)) return true;
    // Another window refreshing this login changes the store too. A logout or another login does not continue the lineage.
    return now.kind === 'oauth' && (await continues(sent.latest, now.credential));
  }

  /** The token to retry with, or undefined to hand the caller the failed response. */
  async function recover(failedAccess: string, sent: SentWith | undefined, signal: AbortSignal): Promise<string | undefined> {
    if (sent && !(await storeStillAgrees(sent))) return undefined;
    const captured = lineage;
    if (!captured || !issued(failedAccess)) return undefined;
    const bound = store;
    // AuthStorage locks auth.json with proper-lockfile. A second lock on auth.json.lock deadlocks modify.
    const access = await latch.run(() => (bound ? refreshStored({ bound, captured, failedAccess, signal }) : refreshLatest(captured, failedAccess)));
    if (!access || access === failedAccess) return undefined;
    if (sent && !(await storeStillAgrees(sent))) return undefined;
    return access;
  }

  return {
    bindCredentials(next) {
      store = next;
    },
    remember(credential, rotation) {
      // A credential that continues no token this provider issued is another login, so earlier tokens stop counting.
      if (lineage && issued((rotation?.replaced ?? credential).access)) lineage.latest = credential;
      else lineage = { latest: credential, replaced: new Set() };
      if (rotation && rotation.replaced.access !== credential.access) lineage.replaced.add(rotation.replaced.access);
    },
    forget() {
      lineage = undefined;
    },
    wrapFetch(base) {
      return async (inputUrl, init) => {
        const sent: SentWith | undefined = store ? undefined : { stored: input.stored(), latest: lineage?.latest };
        const response = await base(inputUrl, init);
        if (!(await isAuthRecoveryTrigger(response))) return response;
        const failedAccess = bearerAccess(init?.headers);
        if (!failedAccess) return response;
        const signal = init?.signal ?? AbortSignal.timeout(REFRESH_TIMEOUT_MS);
        if (signal.aborted) return response;
        const access = await recover(failedAccess, sent, signal).catch(() => undefined);
        return access === undefined ? response : base(inputUrl, { ...init, headers: withBearer(init?.headers, access) });
      };
    },
  };
}
