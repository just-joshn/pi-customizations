import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_EXTENSION = fileURLToPath(new URL('./patch-fetch.ts', import.meta.url));
const REPO_EXTENSION = fileURLToPath(new URL('../../', import.meta.url));
const GROK_PROVIDER = 'spacex-grok';
const CURSOR_PROVIDER = 'spacex-cursor';
const GROK_MODEL = 'grok-4.7';
const CURSOR_MODEL = 'composer-2.5';
const PROFILE_MODE = 0o700;
const DEFAULT_TIMEOUT_MS = 60_000;
const RPC_TIMEOUT_MS = 120_000;
const ZERO = 0;
export const CURSOR_KEY_ENV = 'CURSOR_API_KEY';

interface RpcRecord {
  type?: string;
  id?: string;
  success?: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export const hasPi = (): boolean => spawnSync('pi', ['--version'], { encoding: 'utf8' }).status === 0;
export const hasTmux = (): boolean => spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0;

export interface Profile {
  readonly dir: string;
  path(file: string): string;
  remove(): void;
}

/** An isolated Pi agent directory, so a scenario never reads or writes the real ~/.pi/agent state. */
export function makeProfile(): Profile {
  const dir = mkdtempSync(join(tmpdir(), 'pi-spacex-e2e-'));
  chmodSync(dir, PROFILE_MODE);
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultProvider: GROK_PROVIDER, defaultModel: GROK_MODEL, quietStartup: true }));
  return {
    dir,
    path: (file) => join(dir, file),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface GrokCredential {
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
}

export function writeGrokCredential(profile: Profile, credential: GrokCredential): void {
  writeFileSync(profile.path('auth.json'), JSON.stringify({ [GROK_PROVIDER]: { type: 'oauth', ...credential } }), { mode: PROFILE_MODE });
}

export function readAuth(profile: Profile): Record<string, { type: string; access?: string; refresh?: string; expires?: number }> {
  const file = profile.path('auth.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, { type: string; access?: string; refresh?: string; expires?: number }>) : {};
}

export interface PiRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly profile: Profile;
  readonly grokBase: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

const baseArgs = (): string[] => ['-ne', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--no-session', '-e', REPO_EXTENSION, '-e', PATCH_EXTENSION];

const childEnv = (profile: Profile, grokBase: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...process.env, PI_CODING_AGENT_DIR: profile.dir, E2E_GROK_BASE: grokBase, PI_OFFLINE: '1', ...extra });

/** Runs the real Pi CLI with only this extension and the host redirect loaded. Async, so an in-process fake server can answer. */
export function runPi({ profile, grokBase, args, env = {}, timeoutMs = DEFAULT_TIMEOUT_MS }: RunOptions): Promise<PiRun> {
  const child = spawn('pi', [...baseArgs(), ...args], { env: childEnv(profile, grokBase, env), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Pi did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

export type CursorCredential = { readonly type: 'api_key'; readonly key: string } | { readonly type: 'oauth'; readonly access: string; readonly refresh?: string; readonly expires?: number };

/** The real Cursor credential: CURSOR_API_KEY when set, else a stored spacex-cursor login. */
export function cursorCredential(): CursorCredential | undefined {
  const key = process.env[CURSOR_KEY_ENV];
  if (key) return { type: 'api_key', key };
  const file = join(process.env['HOME'] ?? '', '.pi', 'agent', 'auth.json');
  if (!existsSync(file)) return undefined;
  const stored = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, CursorCredential>)[CURSOR_PROVIDER];
  if (!stored) return undefined;
  return stored.type === 'api_key' ? (stored.key ? stored : undefined) : stored.access ? stored : undefined;
}

/** Seeds a Cursor credential in a profile, without printing it. */
export function writeCursorCredential(profile: Profile, credential: CursorCredential): void {
  const auth = { ...readAuth(profile), [CURSOR_PROVIDER]: credential };
  writeFileSync(profile.path('auth.json'), JSON.stringify(auth), { mode: PROFILE_MODE });
}

export interface RpcSession {
  setModel(provider: string, modelId: string): Promise<void>;
  promptAndWait(message: string): Promise<string>;
  close(): void;
}

const attachReader = (child: ReturnType<typeof spawn>, onRecord: (record: RpcRecord) => void): void => {
  let buffer = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.at(-1) ?? '';
    for (const line of lines.slice(ZERO, -1)) onRecord(JSON.parse(line) as RpcRecord);
  });
};

interface RpcState {
  readonly onRecord: (record: RpcRecord) => void;
  readonly send: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly addSettled: (resolve: () => void) => void;
}

const createRpcState = (child: ReturnType<typeof spawn>): RpcState => {
  let pending = new Map<string, (record: RpcRecord) => void>();
  let settled: (() => void)[] = [];
  let requestId = ZERO;
  const onRecord = (record: RpcRecord): void => {
    if (record.type === 'response' && record.id) {
      const resolve = pending.get(record.id);
      pending = new Map([...pending].filter(([key]) => key !== record.id));
      resolve?.(record);
    }
    if (record.type === 'agent_settled') {
      const [next, ...rest] = settled;
      settled = rest;
      next?.();
    }
  };
  const send = (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
    requestId += 1;
    const id = `req-${requestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending = new Map([...pending].filter(([key]) => key !== id));
        reject(new Error(`Pi RPC timed out on ${String(command['type'])}`));
      }, RPC_TIMEOUT_MS);
      pending = new Map([
        ...pending,
        [
          id,
          (record: RpcRecord) => {
            clearTimeout(timer);
            if (record.success === false) reject(new Error(String(record.error)));
            else resolve(record.data ?? {});
          },
        ],
      ]);
      child.stdin?.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  };
  return {
    onRecord,
    send,
    addSettled: (resolve) => {
      settled = [...settled, resolve];
    },
  };
};

/** A long-lived Pi RPC session, so one test can switch providers in one conversation. */
export function startRpc({ profile, grokBase, env = {} }: Omit<RunOptions, 'args'>): RpcSession {
  const child = spawn('pi', [...baseArgs(), '--mode', 'rpc'], { env: childEnv(profile, grokBase, env), stdio: ['pipe', 'pipe', 'pipe'] });
  const { onRecord, send, addSettled } = createRpcState(child);
  attachReader(child, onRecord);
  return {
    async setModel(provider, modelId) {
      await send({ type: 'set_model', provider, modelId });
    },
    async promptAndWait(message) {
      const done = new Promise<void>((resolve) => {
        addSettled(resolve);
      });
      await send({ type: 'prompt', message });
      await done;
      const { text } = (await send({ type: 'get_last_assistant_text' })) as { text?: string };
      return text ?? '';
    },
    close: () => {
      child.stdin?.end();
      child.kill();
    },
  };
}

export const grokProviderId = GROK_PROVIDER;
export const cursorProviderId = CURSOR_PROVIDER;
export const grokModelId = GROK_MODEL;
export const cursorModelId = CURSOR_MODEL;
