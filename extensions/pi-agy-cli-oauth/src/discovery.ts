/**
 * One probe of a running Antigravity CLI: which models it offers, and which efforts each one accepts.
 *
 * The CLI can answer `-32000` until its keyring read finishes. That race is retried here.
 * The caller owns the connection, so `discover` does not close it.
 */
import { z } from 'zod';
import { connectAcp, type AcpClient } from './acp/client.ts';
import { ACP_METHODS, AUTH_REQUIRED_CODE, CONFIG_MODEL, CONFIG_THOUGHT_LEVEL } from './acp/protocol.ts';
import { AUTH_RETRIES, AUTH_RETRY_DELAY_MS } from './constants.ts';
import { baseModelId } from './model-catalog.ts';
import { EFFORTS, type CatalogEntry, type Discovery, type Effort } from './types.ts';

const ACP_PROTOCOL_VERSION = 1;
const AUTH_REQUIRED_DETAIL = 'Authentication required';
const UNKNOWN_VERSION = 'unknown';
const PROTOCOL_FAILURE = 'Antigravity CLI probe failed';

/** Trailing display suffix the CLI adds per effort. ` (Thinking)` is not one of these. */
const EFFORT_LABEL = / \((Low|Medium|High|XHigh|Max)\)$/;

const FAILURE = z.object({ code: z.number(), message: z.string() });
const BOXED = z.object({
  code: z.unknown().optional(),
  message: z.unknown().optional(),
  cause: z.unknown().optional(),
  error: z.unknown().optional(),
});
const ENOENT = z.object({ code: z.literal('ENOENT') });

const META = z.object({
  antigravity: z.object({ tier: z.object({ name: z.string().optional() }).optional() }).optional(),
});

const INITIALIZE = z.object({
  agentInfo: z.object({ version: z.string().optional() }).optional(),
  _meta: META.optional(),
});

const ADVERTISED = z.object({ modelId: z.string(), name: z.string().optional() });

const SESSION = z.object({
  sessionId: z.string().optional(),
  models: z
    .object({
      availableModels: z.array(ADVERTISED).optional(),
      currentModelId: z.string().optional(),
    })
    .optional(),
  _meta: META.optional(),
});

const CONFIG_RESULT = z.object({
  configOptions: z.array(z.object({ id: z.string(), options: z.array(z.object({ value: z.string() })).optional() })).optional(),
});

export interface ProbeResult {
  available: boolean;
  detail?: string;
  discovery?: Discovery;
}

interface Launch {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
}

interface Initialized {
  version: string;
  tierName: string | undefined;
}

interface AdvertisedModel {
  modelId: string;
  name: string | undefined;
}

interface OpenedSession {
  sessionId: string;
  tierName: string | undefined;
  currentModelId: string | undefined;
  models: readonly AdvertisedModel[];
}

interface Group {
  baseId: string;
  name: string;
  variants: readonly string[];
}

interface Failure {
  code: number;
  message: string;
}

/** Probe one running CLI connection: `initialize`, then `session/new`, then ask the CLI which efforts each model offers. */
export async function discover(client: AcpClient, options?: { signal?: AbortSignal }): Promise<Discovery> {
  return discoverAt(client, process.cwd(), options?.signal);
}

/** One-shot probe of an installation: connect, discover, close. Reports `available: false` with a `detail` when the binary is missing, not logged in, or the protocol fails. */
export async function probe(launch: Launch, options?: { cwd?: string; signal?: AbortSignal }): Promise<ProbeResult> {
  const cwd = options?.cwd ?? process.cwd();
  try {
    return { available: true, discovery: await connectedDiscovery(launch, cwd, options?.signal) };
  } catch (error) {
    return { available: false, detail: failureDetail(error, launch.command) };
  }
}

async function connectedDiscovery(launch: Launch, cwd: string, signal: AbortSignal | undefined): Promise<Discovery> {
  const client = await connectAcp({ command: launch.command, args: launch.args, env: launch.env, cwd });
  try {
    return await discoverAt(client, cwd, signal);
  } finally {
    client.close();
  }
}

async function discoverAt(client: AcpClient, cwd: string, signal: AbortSignal | undefined): Promise<Discovery> {
  const initialized = await readInitialize(client, signal);
  const session = await openSession(client, cwd, signal);
  const models = await loadCatalog(client, session, signal);
  await restoreCurrentModel(client, session, signal);
  // `_meta.antigravity.tier` is on `session/new` in the measured protocol. Initialize is the fallback.
  return { version: initialized.version, tierName: session.tierName ?? initialized.tierName, models };
}

async function readInitialize(client: AcpClient, signal: AbortSignal | undefined): Promise<Initialized> {
  const result = await authRequest(
    client,
    ACP_METHODS.initialize,
    {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: {}, terminal: false },
    },
    signal,
  );
  const parsed = parseResult(INITIALIZE, result, 'initialize');
  return { version: versionOf(parsed.agentInfo?.version), tierName: tierOf(parsed._meta) };
}

async function openSession(client: AcpClient, cwd: string, signal: AbortSignal | undefined): Promise<OpenedSession> {
  const result = await authRequest(client, ACP_METHODS.newSession, { cwd, mcpServers: [] }, signal);
  const parsed = parseResult(SESSION, result, 'session/new');
  const sessionId = present(parsed.sessionId);
  if (sessionId === undefined) throw new Error('Antigravity CLI did not open a session');
  const advertised = parsed.models?.availableModels ?? [];
  return {
    sessionId,
    tierName: tierOf(parsed._meta),
    currentModelId: present(parsed.models?.currentModelId),
    models: advertised.map((model) => ({ modelId: model.modelId, name: model.name })),
  };
}

async function loadCatalog(client: AcpClient, session: OpenedSession, signal: AbortSignal | undefined): Promise<readonly CatalogEntry[]> {
  return withEfforts(client, session.sessionId, collapse(session.models), signal, 0);
}

async function withEfforts(client: AcpClient, sessionId: string, groups: readonly Group[], signal: AbortSignal | undefined, index: number): Promise<readonly CatalogEntry[]> {
  const group = groups[index];
  if (group === undefined) return [];
  const efforts = await effortsFor(client, sessionId, group.baseId, signal);
  const rest = await withEfforts(client, sessionId, groups, signal, index + 1);
  return [{ baseId: group.baseId, name: group.name, variants: group.variants, efforts }, ...rest];
}

async function effortsFor(client: AcpClient, sessionId: string, baseId: string, signal: AbortSignal | undefined): Promise<readonly Effort[]> {
  try {
    const result = await client.request(ACP_METHODS.setConfigOption, { sessionId, configId: CONFIG_MODEL, value: baseId }, callOptions(signal));
    return effortsFrom(result);
  } catch {
    // One model rejecting `model` must not drop the rest of the catalog.
    return [];
  }
}

async function restoreCurrentModel(client: AcpClient, session: OpenedSession, signal: AbortSignal | undefined): Promise<void> {
  if (session.currentModelId === undefined) return;
  try {
    await client.request(ACP_METHODS.setConfigOption, { sessionId: session.sessionId, configId: CONFIG_MODEL, value: session.currentModelId }, callOptions(signal));
  } catch {
    // The catalog is already known. The caller closes this session.
  }
}

function collapse(models: readonly AdvertisedModel[]): readonly Group[] {
  return models.reduce<readonly Group[]>((groups, model) => addVariant(groups, model), []);
}

function addVariant(groups: readonly Group[], model: AdvertisedModel): readonly Group[] {
  const baseId = baseModelId(model.modelId);
  const current = groups.find((group) => group.baseId === baseId);
  if (current === undefined) {
    return [...groups, { baseId, name: displayName(model.name ?? baseId), variants: [model.modelId] }];
  }
  if (current.variants.includes(model.modelId)) return groups;
  const next = { ...current, variants: [...current.variants, model.modelId] };
  return groups.map((group) => (group.baseId === baseId ? next : group));
}

function displayName(name: string): string {
  return name.replace(EFFORT_LABEL, '');
}

function effortsFrom(result: unknown): readonly Effort[] {
  const parsed = CONFIG_RESULT.safeParse(result);
  if (!parsed.success) return [];
  const thought = parsed.data.configOptions?.find((option) => option.id === CONFIG_THOUGHT_LEVEL);
  return knownEfforts((thought?.options ?? []).map((option) => option.value));
}

function knownEfforts(values: readonly string[]): readonly Effort[] {
  const efforts = values.filter((value): value is Effort => EFFORTS.some((effort) => effort === value));
  return [...new Set(efforts)];
}

/** `initialize` and `session/new` both return this code until the keyring read finishes. */
async function authRequest(client: AcpClient, method: string, params: unknown, signal: AbortSignal | undefined): Promise<unknown> {
  return retryAuth(client, method, params, signal, AUTH_RETRIES);
}

async function retryAuth(client: AcpClient, method: string, params: unknown, signal: AbortSignal | undefined, remaining: number): Promise<unknown> {
  try {
    return await client.request(method, params, callOptions(signal));
  } catch (error) {
    if (!isAuthRequired(error) || remaining === 0) throw error;
    await delay(AUTH_RETRY_DELAY_MS, signal);
    return retryAuth(client, method, params, signal, remaining - 1);
  }
}

function callOptions(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error('Aborted');
}

function isAuthRequired(error: unknown): boolean {
  if (readFailure(error)?.code === AUTH_REQUIRED_CODE) return true;
  return error instanceof Error && error.message === AUTH_REQUIRED_DETAIL;
}

function failureDetail(error: unknown, command: string): string {
  if (isAuthRequired(error)) return AUTH_REQUIRED_DETAIL;
  if (ENOENT.safeParse(error).success) return `Antigravity CLI was not found: ${command}`;
  const failure = readFailure(error);
  if (failure !== undefined && failure.message !== '') return failure.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return PROTOCOL_FAILURE;
}

function readFailure(error: unknown, depth = 0): Failure | undefined {
  if (depth > 1) return undefined;
  const direct = FAILURE.safeParse(error);
  if (direct.success) return direct.data;
  const boxed = BOXED.safeParse(error);
  if (!boxed.success) return undefined;
  const shaped = FAILURE.safeParse({ code: boxed.data.code, message: boxed.data.message });
  if (shaped.success) return shaped.data;
  return readFailure(boxed.data.cause, depth + 1) ?? readFailure(boxed.data.error, depth + 1);
}

function parseResult<T extends z.ZodType>(schema: T, value: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Antigravity CLI returned an unreadable ${label} result`);
  return result.data;
}

function versionOf(version: string | undefined): string {
  return present(version) ?? UNKNOWN_VERSION;
}

function tierOf(meta: z.infer<typeof META> | undefined): string | undefined {
  return present(meta?.antigravity?.tier?.name);
}

function present(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  return value;
}
