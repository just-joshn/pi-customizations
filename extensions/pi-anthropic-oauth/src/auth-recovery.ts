import type { CredentialStore, FetchFunction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { createRefreshLatch } from './refresh-latch.ts';

const REFRESH_TIMEOUT_MS = 15_000;

export type AuthRecovery = {
  bindCredentials(store: CredentialStore): void;
  remember(credential: OAuthCredential): void;
  wrapFetch(base: FetchFunction): FetchFunction;
};

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

/** Claude FE phrases that force refresh on HTTP 403 (fixture + 2.1.316 SDK string). */
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

/** One forced refresh under an in-process latch, then one HTTP retry on 401 or revoked 403. */
export function createAuthRecovery(input: { providerId: string; oauth: OAuthAuth }): AuthRecovery {
  let store: CredentialStore | undefined;
  let remembered: OAuthCredential | undefined;
  const latch = createRefreshLatch<string | undefined>();

  async function refreshAfterAuthFailure(failedAccess: string, signal: AbortSignal): Promise<string | undefined> {
    return latch.run(async () => {
      if (store) {
        const post = await store.modify(
          input.providerId,
          async (current) => {
            if (current?.type !== 'oauth') return undefined;
            if (current.access !== failedAccess) return undefined;
            return input.oauth.refresh(current, AbortSignal.timeout(REFRESH_TIMEOUT_MS));
          },
          { signal },
        );
        if (post?.type === 'oauth') {
          remembered = post;
          return post.access;
        }
        return undefined;
      }
      if (!remembered) return undefined;
      if (remembered.access !== failedAccess) return remembered.access;
      const next = await input.oauth.refresh(remembered, AbortSignal.timeout(REFRESH_TIMEOUT_MS));
      remembered = next;
      return next.access;
    });
  }

  return {
    bindCredentials(next) {
      store = next;
    },
    remember(credential) {
      remembered = credential;
    },
    wrapFetch(base) {
      return async (inputUrl, init) => {
        const response = await base(inputUrl, init);
        if (!(await isAuthRecoveryTrigger(response))) return response;
        const failedAccess = bearerAccess(init?.headers);
        if (!failedAccess) return response;
        const signal = init?.signal ?? AbortSignal.timeout(REFRESH_TIMEOUT_MS);
        if (signal.aborted) return response;
        let access: string | undefined;
        try {
          access = await refreshAfterAuthFailure(failedAccess, signal);
        } catch {
          return response;
        }
        if (!access || access === failedAccess) return response;
        return base(inputUrl, { ...init, headers: withBearer(init?.headers, access) });
      };
    },
  };
}
