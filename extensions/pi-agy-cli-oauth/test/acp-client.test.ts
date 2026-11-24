import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpTransportError, connectAcp, type AcpClient } from '../src/acp/client.ts';
import { ACP_METHODS, AUTH_REQUIRED_CODE, type InitializeResult, type PromptResult } from '../src/acp/protocol.ts';
// Importing `fake-agy.ts` starts its stdin read loop, so the names are copied from its `SCENARIOS` export.
const SCENARIOS = {
  ready: 'ready',
  signedOut: 'signed-out',
  toolCall: 'tool-call',
  malformed: 'malformed',
  slow: 'slow',
  crash: 'crash',
} as const;

type Scenario = (typeof SCENARIOS)[keyof typeof SCENARIOS];

const SHORT_TIMEOUT_MS = 300;
const STOP_WAIT_MS = 8_000;

const fakeAgy = fileURLToPath(new URL('./fake-agy.ts', import.meta.url));
const promptParams = { sessionId: 'fake-session', prompt: [] };
let clients: readonly AcpClient[] = [];

function testEnv(scenario: Scenario): Record<string, string> {
  const entries = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return { ...Object.fromEntries(entries), FAKE_AGY_SCENARIO: scenario };
}

async function connect(scenario: Scenario): Promise<AcpClient> {
  const client = await connectAcp({
    command: process.execPath,
    args: ['--experimental-strip-types', fakeAgy],
    env: testEnv(scenario),
    cwd: process.cwd(),
  });
  clients = [...clients, client];
  return client;
}

function stopped(client: AcpClient): Promise<unknown> {
  return vi.waitFor(() => expect(client.alive).toBe(false), { timeout: STOP_WAIT_MS });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the ACP call to reject');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

afterEach(async () => {
  const open = clients;
  clients = [];
  for (const client of open) client.close();
  await Promise.all(open.map((client) => stopped(client)));
});

describe('connectAcp session', () => {
  it('round-trips initialize', async () => {
    const client = await connect(SCENARIOS.ready);
    client.notify(ACP_METHODS.cancel, { sessionId: 'fake-session' });
    const result = await client.request<InitializeResult>(ACP_METHODS.initialize, { protocolVersion: 1 });
    expect(result.protocolVersion).toBe(1);
    expect(result.agentInfo?.name).toBe('Antigravity ACP Server');
  });

  it('delivers session updates until unsubscribe', async () => {
    const client = await connect(SCENARIOS.ready);
    let updates: readonly unknown[] = [];
    const unsubscribe = client.onNotification((method, params) => {
      if (method !== ACP_METHODS.update) return;
      updates = [...updates, params];
    });
    await client.request<PromptResult>(ACP_METHODS.prompt, promptParams);
    expect(JSON.stringify(updates)).toContain('hello');
    const delivered = updates.length;
    expect(delivered).toBeGreaterThan(0);
    unsubscribe();
    await client.request(ACP_METHODS.prompt, promptParams);
    expect(updates.length).toBe(delivered);
  });

  it('keeps the session after a malformed stdout line', async () => {
    const client = await connect(SCENARIOS.malformed);
    let text = '';
    client.onNotification((method, params) => {
      if (method !== ACP_METHODS.update) return;
      text += JSON.stringify(params);
    });
    const result = await client.request<PromptResult>(ACP_METHODS.prompt, promptParams);
    expect(result.stopReason).toBe('end_turn');
    expect(text).toContain('Recovered.');
  });
});

describe('connectAcp server requests', () => {
  it('hands a permission request to the handler and leaves the prompt pending', async () => {
    const client = await connect(SCENARIOS.toolCall);
    let seen: unknown;
    client.setServerRequestHandler((method, params) => {
      seen = { method, params };
      return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    });
    let settled = false;
    void client.request(ACP_METHODS.prompt, promptParams).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.waitFor(() => {
      expect(seen).toMatchObject({
        method: ACP_METHODS.requestPermission,
        params: { toolCall: { rawInput: { CommandLine: 'ls -la' } } },
      });
    });
    expect(settled).toBe(false);
  });
});

describe('connectAcp failures', () => {
  it('rejects a JSON-RPC error with the CLI code and message', async () => {
    const client = await connect(SCENARIOS.signedOut);
    const error = await rejectionOf(client.request(ACP_METHODS.initialize, {}));
    expect(error).toBeInstanceOf(AcpTransportError);
    expect(messageOf(error)).toBe('Authentication required');
    expect(error instanceof AcpTransportError ? error.code : undefined).toBe(AUTH_REQUIRED_CODE);
  });

  it('rejects pending calls when the child exits', async () => {
    const client = await connect(SCENARIOS.crash);
    const error = await rejectionOf(client.request(ACP_METHODS.prompt, promptParams));
    expect(messageOf(error)).toBe(`agy exited with code 1 signal none: ${client.stderrTail}`);
  });

  it('rejects when the request times out', async () => {
    const client = await connect(SCENARIOS.slow);
    const error = await rejectionOf(client.request(ACP_METHODS.prompt, promptParams, { timeoutMs: SHORT_TIMEOUT_MS }));
    expect(messageOf(error)).toContain('timed out');
  });

  it('rejects when the caller aborts', async () => {
    const client = await connect(SCENARIOS.slow);
    const controller = new AbortController();
    const pending = client.request(ACP_METHODS.prompt, promptParams, { signal: controller.signal });
    controller.abort();
    expect(messageOf(await rejectionOf(pending))).toMatch(/abort/i);
  });
});

describe('connectAcp close', () => {
  it('is idempotent and leaves the process dead', async () => {
    const handles = activeHandles();
    const client = await connect(SCENARIOS.ready);
    client.close();
    client.close();
    await stopped(client);
    expect(client.alive).toBe(false);
    const error = await rejectionOf(client.request(ACP_METHODS.initialize, {}));
    expect(messageOf(error)).toBe(`agy exited with code 0 signal none: ${client.stderrTail}`);
    expect(activeHandles()).toBeLessThanOrEqual(handles);
  });
});

function activeHandles(): number {
  return process.getActiveResourcesInfo().length;
}
