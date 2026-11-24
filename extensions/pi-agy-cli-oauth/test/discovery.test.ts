import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { connectAcp, type AcpClient } from '../src/acp/client.ts';
import { ACP_METHODS, AUTH_REQUIRED_CODE, CONFIG_MODEL, CONFIG_THOUGHT_LEVEL } from '../src/acp/protocol.ts';
import { AUTH_RETRIES, AUTH_RETRY_DELAY_MS, HANDSHAKE_TIMEOUT_MS } from '../src/constants.ts';
import { discover, probe, type ProbeResult } from '../src/discovery.ts';
import { EFFORTS, type CatalogEntry } from '../src/types.ts';

/** Values of `SCENARIOS` in `fake-agy.ts`. Importing that module would read this process's stdin. */
const READY = 'ready';
const SIGNED_OUT = 'signed-out';

const AUTH_FAILURE_TIMEOUT_MS = AUTH_RETRY_DELAY_MS * AUTH_RETRIES + HANDSHAKE_TIMEOUT_MS;

const GEMINI: CatalogEntry = {
  baseId: 'gemini-3.8-flash',
  name: 'Gemini 3.8 Flash',
  efforts: ['low', 'medium', 'high'],
  variants: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low'],
};

const OSS: CatalogEntry = {
  baseId: 'gpt-oss-120b',
  name: 'GPT-OSS 120B',
  efforts: ['medium'],
  variants: ['gpt-oss-120b-medium'],
};

const CLAUDE: CatalogEntry = {
  baseId: 'claude-sonnet-4-6',
  name: 'Claude Sonnet 4.6 (Thinking)',
  efforts: [],
  variants: ['claude-sonnet-4-6'],
};

function definedEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function fakeScript(): string {
  return fileURLToPath(new URL('./fake-agy.ts', import.meta.url));
}

function fakeLaunch(scenario: string): { command: string; args: readonly string[]; env: Record<string, string> } {
  return {
    command: process.execPath,
    args: ['--experimental-strip-types', fakeScript()],
    env: { ...definedEnv(), FAKE_AGY_SCENARIO: scenario },
  };
}

function probeFake(scenario: string): Promise<ProbeResult> {
  return probe(fakeLaunch(scenario), { cwd: process.cwd() });
}

async function discoverFake(scenario: string): Promise<{ client: AcpClient; discovery: Awaited<ReturnType<typeof discover>> }> {
  const client = await connectAcp({ ...fakeLaunch(scenario), cwd: process.cwd() });
  try {
    return { client, discovery: await discover(client) };
  } catch (error) {
    client.close();
    throw error;
  }
}

it('reports the efforts the CLI offers for each base model', async () => {
  const result = await probeFake(READY);
  expect(result.available).toBe(true);
  expect(result.detail).toBeUndefined();
  const found = result.discovery;
  if (found === undefined) throw new Error('expected a discovery');
  expect(found.version).toBe('1.5.15');
  expect(found.tierName).toBe('Antigravity Starter Quota');
  expect(found.models.map((model) => model.baseId)).toEqual(['gemini-3.8-flash', 'claude-sonnet-4-6', 'gpt-oss-120b']);
  const gemini = found.models[0];
  const oss = found.models[2];
  if (gemini === undefined || oss === undefined) throw new Error('expected the advertised models');
  expect(gemini).toEqual(GEMINI);
  expect(oss).toEqual(OSS);
});

it('reports an empty effort list when the CLI has no thought_level', async () => {
  const { client, discovery } = await discoverFake(READY);
  try {
    expect(client.alive).toBe(true);
    const claude = discovery.models[1];
    if (claude === undefined) throw new Error('expected the Claude entry');
    expect(claude).toEqual(CLAUDE);
  } finally {
    client.close();
  }
});

it(
  'reports Authentication required after the keyring retries are exhausted',
  async () => {
    const started = Date.now();
    const result = await probeFake(SIGNED_OUT);
    expect(result).toEqual({ available: false, detail: 'Authentication required' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(AUTH_RETRIES * AUTH_RETRY_DELAY_MS);
  },
  AUTH_FAILURE_TIMEOUT_MS,
);

it('collapses an xhigh suffix onto the same base id', async () => {
  const discovery = await discover(scriptedClient(xhighCatalog));
  const model = discovery.models[0];
  if (model === undefined) throw new Error('expected one model');
  expect(model).toEqual({
    baseId: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    efforts: [...EFFORTS],
    variants: ['gemini-3.8-flash-xhigh', 'gemini-3.8-flash-max'],
  });
});

it('keeps the model when selecting it fails', async () => {
  const discovery = await discover(scriptedClient(rejectingModel));
  expect(discovery.models).toEqual([CLAUDE]);
});

class AuthRequired extends Error {
  readonly code = AUTH_REQUIRED_CODE;
  constructor() {
    super('Authentication required');
  }
}

it(
  'retries an authentication failure until the budget is spent',
  async () => {
    let attempts = 0;
    const client = scriptedClient(() => {
      attempts += 1;
      throw new AuthRequired();
    });
    const started = Date.now();
    await expect(discover(client)).rejects.toThrow('Authentication required');
    expect(attempts).toBe(AUTH_RETRIES + 1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(AUTH_RETRIES * AUTH_RETRY_DELAY_MS);
  },
  AUTH_FAILURE_TIMEOUT_MS,
);

it('reports a missing CLI without a discovery', async () => {
  const command = 'agy-not-installed';
  const result = await probe({ command, args: ['acp', '--stdio'], env: definedEnv() }, { cwd: process.cwd() });
  expect(result.available).toBe(false);
  expect(result.discovery).toBeUndefined();
  expect(result.detail).toContain(command);
});

function scriptedClient(respond: (method: string, params: unknown) => unknown): AcpClient {
  return {
    async request<T>(method: string, params: unknown): Promise<T> {
      return respond(method, params) as T;
    },
    notify: () => undefined,
    setServerRequestHandler: () => undefined,
    onNotification: () => () => undefined,
    stderrTail: '',
    alive: true,
    close: () => undefined,
  };
}

function xhighCatalog(method: string): unknown {
  if (method === ACP_METHODS.initialize) return { agentInfo: { version: '1.5.15' } };
  if (method === ACP_METHODS.newSession) {
    return {
      sessionId: 's',
      models: {
        currentModelId: 'gemini-3.8-flash-xhigh',
        availableModels: [
          { modelId: 'gemini-3.8-flash-xhigh', name: 'Gemini 3.8 Flash (XHigh)' },
          { modelId: 'gemini-3.8-flash-max', name: 'Gemini 3.8 Flash (Max)' },
        ],
      },
    };
  }
  if (method === ACP_METHODS.setConfigOption) {
    return { configOptions: [{ id: CONFIG_THOUGHT_LEVEL, options: EFFORTS.map((value) => ({ value })) }] };
  }
  throw new Error(`unexpected method ${method}`);
}

function rejectingModel(method: string, params: unknown): unknown {
  if (method === ACP_METHODS.initialize) return { agentInfo: { version: '1.5.15' } };
  if (method === ACP_METHODS.newSession) {
    return {
      sessionId: 's',
      models: { availableModels: [{ modelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' }] },
    };
  }
  if (method === ACP_METHODS.setConfigOption && isRecord(params) && params['configId'] === CONFIG_MODEL) {
    throw new Error('rejected');
  }
  throw new Error(`unexpected method ${method}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
