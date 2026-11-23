import { afterEach, describe, expect, test, vi } from 'vitest';
import { cursorApiKey } from '../src/cursor/config.ts';

const ENV_KEY = 'CURSOR_API_KEY';
const OAUTH_KEY = 'oauth-key';
const STORED_KEY = 'stored-key';
const ENV_VALUE = 'env-key';

afterEach(() => vi.unstubAllEnvs());

describe('the Cursor API key Pi resolves', () => {
  test('uses the key from a signed-in credential', () => {
    vi.stubEnv(ENV_KEY, ENV_VALUE);
    expect(cursorApiKey({ type: 'oauth', access: OAUTH_KEY, refresh: '', expires: 0 })).toBe(OAUTH_KEY);
  });

  test('uses the key stored as an API key credential', () => {
    vi.stubEnv(ENV_KEY, ENV_VALUE);
    expect(cursorApiKey({ type: 'api_key', key: STORED_KEY })).toBe(STORED_KEY);
  });

  test('falls back to CURSOR_API_KEY when the credential carries no key', () => {
    vi.stubEnv(ENV_KEY, ENV_VALUE);
    expect(cursorApiKey({ type: 'api_key' })).toBe(ENV_VALUE);
  });

  test('resolves no key when neither a credential nor the environment has one', () => {
    vi.stubEnv(ENV_KEY, '');
    expect(cursorApiKey(undefined)).toBeUndefined();
  });
});
