import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { type FakeGrok, startFakeGrok, unauthorized } from './fake-grok.ts';
import { cursorCredential, cursorModelId, cursorProviderId, grokModelId, grokProviderId, hasPi, hasTmux, makeProfile, readAuth, runPi, startRpc, writeCursorCredential, writeGrokCredential, type Profile } from './pi-harness.ts';

const ACCESS = 'e2e-access';
const REFRESH = 'e2e-refresh';
const REFRESHED = 'e2e-refreshed-access';
const TOKEN_LIFETIME_MS = 3_600_000;
const EXPIRED = 0;
const DEVICE_CODE_CALLS = 1;
const E2E_TEST_TIMEOUT_MS = 90_000;
const TMUX_STEP_MS = 2_000;
const TMUX_FILTER_MS = 1_000;
const TUI_START_MS = 4_000;
const POLL_MS = 250;
const TMUX_WIDTH = 140;
const TMUX_HEIGHT = 40;
const E2E_FILE = 'E2E_TOOL_STDOUT';
const UNAUTHORIZED_MENTION = '401';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

const live = hasPi();
const tmux = hasTmux();
const cursor = live ? cursorCredential() : undefined;

let grok: FakeGrok;
let profile: Profile | undefined;

beforeAll(async () => {
  if (live) grok = await startFakeGrok();
});
afterAll(async () => {
  await grok?.close();
});
afterEach(() => {
  profile?.remove();
  profile = undefined;
});
beforeEach(() => {
  if (live) grok.reset();
});

const freshProfile = (): Profile => {
  profile = makeProfile();
  return profile;
};

const seedGrok = (p: Profile, access = ACCESS, refresh = REFRESH, expires = Date.now() + TOKEN_LIFETIME_MS): void => writeGrokCredential(p, { access, refresh, expires });

const pause = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const waitFor = async (condition: () => boolean, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await pause(POLL_MS);
  }
  return false;
};

const run = promisify(execFile);

const tmuxRun = async (...args: string[]): Promise<void> => {
  await run('tmux', args);
};

const capture = async (session: string): Promise<string> => (await run('tmux', ['capture-pane', '-pt', session])).stdout;

describe.skipIf(!live)('Pi loads the extension', () => {
  test('registers both providers and their built-in models', async () => {
    const p = freshProfile();
    seedGrok(p);
    writeCursorCredential(p, { type: 'oauth', access: 'fake-cursor-key', refresh: '', expires: EXPIRED });
    const result = await runPi({ profile: p, grokBase: grok.url, args: ['--list-models'] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(grokProviderId);
    expect(result.stdout).toContain(cursorProviderId);
    expect(result.stdout).toContain(grokModelId);
    expect(result.stdout).toContain(cursorModelId);
  });

  test('produces a Grok response through the provider', async () => {
    const p = freshProfile();
    seedGrok(p);
    const result = await runPi({ profile: p, grokBase: grok.url, args: ['-p', '--model', `${grokProviderId}/${grokModelId}`, 'say hi'] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('E2E_OK');
    const responses = grok.requests().filter((request) => request.path === '/v1/responses');
    expect(responses).toHaveLength(1);
    expect(responses[0]?.authorization).toBe(`Bearer ${ACCESS}`);
  });

  test('refreshes an expired credential and then answers', async () => {
    const p = freshProfile();
    seedGrok(p, 'stale-access', REFRESH, EXPIRED);
    const result = await runPi({ profile: p, grokBase: grok.url, args: ['-p', '--model', `${grokProviderId}/${grokModelId}`, 'say hi'] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('E2E_OK');
    expect(readAuth(p)[grokProviderId]?.access).toBe(REFRESHED);
    expect(grok.requests().some((request) => request.path === '/oauth2/token' && request.body.includes('grant_type=refresh_token'))).toBe(true);
  });
});

describe.skipIf(!live)('Pi runs tools and reports failures', () => {
  test('finishes a tool-using turn through the real tool loop', async () => {
    const p = freshProfile();
    seedGrok(p);
    const file = join(p.dir, 'tool-input.txt');
    writeFileSync(file, E2E_FILE);
    grok.replySequence([{ kind: 'tool', name: 'read', args: JSON.stringify({ path: file }) }, { kind: 'echo-tool-output' }]);
    const result = await runPi({ profile: p, grokBase: grok.url, args: ['-p', '--model', `${grokProviderId}/${grokModelId}`, 'read the file'] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SAW_TOOL_OUTPUT');
    expect(grok.requests().some((request) => request.body.includes(E2E_FILE))).toBe(true);
  });

  test('reports a 401 instead of crashing', async () => {
    const p = freshProfile();
    seedGrok(p);
    grok.reply(unauthorized);
    const result = await runPi({ profile: p, grokBase: grok.url, args: ['-p', '--model', `${grokProviderId}/${grokModelId}`, 'say hi'] });
    expect(`${result.stdout}${result.stderr}`).toContain(UNAUTHORIZED_MENTION);
    expect(result.stderr).not.toContain('UnhandledPromiseRejection');
  });

  test('reports a network failure instead of crashing', async () => {
    const p = freshProfile();
    seedGrok(p);
    const closed = await startFakeGrok();
    await closed.close();
    const result = await runPi({ profile: p, grokBase: closed.url, args: ['-p', '--model', `${grokProviderId}/${grokModelId}`, 'say hi'] });
    expect(`${result.stdout}${result.stderr}`).toMatch(/ECONNREFUSED|fetch failed|Connection error/i);
    expect(result.stderr).not.toContain('UnhandledPromiseRejection');
  });

  test('keeps the access token out of Pi output', async () => {
    const p = freshProfile();
    seedGrok(p, 'secret-sentinel-access', 'secret-sentinel-refresh');
    const result = await runPi({ profile: p, grokBase: grok.url, args: ['-p', '--model', `${grokProviderId}/${grokModelId}`, 'say hi'] });
    expect(result.stdout).not.toContain('secret-sentinel-access');
    expect(result.stderr).not.toContain('secret-sentinel-access');
    expect(result.stdout).not.toContain('secret-sentinel-refresh');
  });
});

describe.skipIf(!live || !tmux)('Pi login through the terminal', () => {
  test(
    'completes the Grok device sign-in',
    async () => {
      const p = freshProfile();
      const session = `spacex-e2e-${Date.now()}`;
      const extension = process.cwd();
      const patch = join(extension, 'test/e2e/patch-fetch.ts');
      const command = `env PI_CODING_AGENT_DIR=${p.dir} E2E_GROK_BASE=${grok.url} PI_OFFLINE=1 pi -ne --no-skills --no-mcp --no-session -e ${extension} -e ${patch}`;
      await tmuxRun('new-session', '-d', '-s', session, '-x', String(TMUX_WIDTH), '-y', String(TMUX_HEIGHT), command);
      try {
        await pause(TUI_START_MS);
        await tmuxRun('send-keys', '-t', session, '/login', 'Enter');
        await pause(TMUX_STEP_MS);
        await tmuxRun('send-keys', '-t', session, 'Enter');
        await pause(TMUX_STEP_MS);
        await tmuxRun('send-keys', '-t', session, '-l', 'Grok Build');
        await pause(TMUX_FILTER_MS);
        await tmuxRun('send-keys', '-t', session, 'Enter');
        const signedIn = await waitFor(() => readAuth(p)[grokProviderId]?.type === 'oauth', E2E_TEST_TIMEOUT_MS);
        if (!signedIn) throw new Error(`no credential was stored. Screen:\n${await capture(session)}`);
        expect(grok.requests().filter((request) => request.path === '/oauth2/device/code')).toHaveLength(DEVICE_CODE_CALLS);
      } finally {
        await tmuxRun('kill-session', '-t', session);
      }
    },
    E2E_TEST_TIMEOUT_MS,
  );
});

describe.skipIf(!live || !cursor)('Cursor through Pi', () => {
  test(
    'answers through the Cursor SDK',
    async () => {
      const p = freshProfile();
      seedGrok(p);
      if (cursor) writeCursorCredential(p, cursor);
      const result = await runPi({ profile: p, grokBase: grok.url, args: ['-p', '--model', `${cursorProviderId}/${cursorModelId}`, 'Reply with CURSOR_E2E_OK'] });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('CURSOR_E2E_OK');
    },
    E2E_TEST_TIMEOUT_MS,
  );

  test(
    'switches Grok to Cursor to Grok in one session',
    async () => {
      const p = freshProfile();
      seedGrok(p);
      if (cursor) writeCursorCredential(p, cursor);
      const rpc = startRpc({ profile: p, grokBase: grok.url });
      try {
        await rpc.setModel(grokProviderId, grokModelId);
        expect(await rpc.promptAndWait('say hi')).toContain('E2E_OK');
        await rpc.setModel(cursorProviderId, cursorModelId);
        expect(await rpc.promptAndWait('Reply with CURSOR_E2E_OK')).toContain('CURSOR_E2E_OK');
        await rpc.setModel(grokProviderId, grokModelId);
        expect(await rpc.promptAndWait('say hi again')).toContain('E2E_OK');
      } finally {
        rpc.close();
      }
    },
    E2E_TEST_TIMEOUT_MS,
  );
});
