import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CredentialStore, FetchFunction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { refreshLockPathFor, withRefreshFileLock, type RefreshFileLockOptions } from './refresh-file-lock.ts';
import { createRefreshLatch } from './refresh-latch.ts';

const REFRESH_TIMEOUT_MS = 15_000;

export type AuthRecovery = {
  bindCredentials(store: CredentialStore): void;
  /** Optional auth.json path for cross-process refresh locking. */
  bindRefreshLockTarget(targetPath: string | undefined): void;
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

const REFRESH_SHARE_FILENAME = 'claude-subscription-refresh.json';

function sharePathFor(targetPath: string, options: RefreshFileLockOptions | undefined): string {
  const lockPath = options?.lockPath ?? refreshLockPathFor(targetPath);
  return join(dirname(lockPath), REFRESH_SHARE_FILENAME);
}

function isOAuthCredential(value: unknown): value is OAuthCredential {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['type'] === 'oauth' && typeof record['access'] === 'string' && typeof record['refresh'] === 'string' && typeof record['expires'] === 'number';
}

async function readSharedCredential(path: string): Promise<OAuthCredential | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isOAuthCredential(parsed) ? parsed : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writeSharedCredential(path: string, credential: OAuthCredential): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(credential)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** One forced refresh under an in-process latch, then one HTTP retry on 401 or revoked 403. */
export function createAuthRecovery(input: {
  providerId: string;
  oauth: OAuthAuth;
  /** Auth file whose directory holds the no-store refresh lock. Ignored while a credential store is bound. */
  refreshLockTarget?: string;
  refreshLockOptions?: RefreshFileLockOptions;
}): AuthRecovery {
  let store: CredentialStore | undefined;
  let remembered: OAuthCredential | undefined;
  let refreshLockTarget = input.refreshLockTarget;
  const latch = createRefreshLatch<string | undefined>();

  async function refreshStored(failedAccess: string, signal: AbortSignal): Promise<string | undefined> {
    const bound = store;
    if (!bound) return undefined;
    const post = await bound.modify(
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

  async function refreshRemembered(failedAccess: string, signal: AbortSignal): Promise<string | undefined> {
    const target = refreshLockTarget;
    const run = async () => {
      if (target) {
        const shared = await readSharedCredential(sharePathFor(target, input.refreshLockOptions));
        if (shared && shared.access !== failedAccess && shared.expires > Date.now()) {
          remembered = shared;
          return shared.access;
        }
      }
      const current = remembered;
      if (!current) return undefined;
      if (current.access !== failedAccess) return current.access;
      const next = await input.oauth.refresh(current, AbortSignal.timeout(REFRESH_TIMEOUT_MS));
      if (target) await writeSharedCredential(sharePathFor(target, input.refreshLockOptions), next);
      remembered = next;
      return next.access;
    };
    if (!target) return run();
    return withRefreshFileLock(target, run, input.refreshLockOptions, signal);
  }

  async function refreshAfterAuthFailure(failedAccess: string, signal: AbortSignal): Promise<string | undefined> {
    return latch.run(() => {
      // AuthStorage locks auth.json with proper-lockfile. A second lock on auth.json.lock deadlocks modify.
      if (store) return refreshStored(failedAccess, signal);
      return refreshRemembered(failedAccess, signal);
    });
  }

  return {
    bindCredentials(next) {
      store = next;
    },
    bindRefreshLockTarget(targetPath) {
      refreshLockTarget = targetPath;
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
