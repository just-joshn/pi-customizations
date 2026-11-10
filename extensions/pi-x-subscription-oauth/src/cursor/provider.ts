import { createProvider, type OAuthCredential, type Provider, type ProviderAuthInteraction, type RefreshModelsContext } from '@earendil-works/pi-ai';
import { loginCursor, readKeychainCredential, refreshCursor, runCursorAgentLogin } from './auth.ts';
import { BASELINE, CURSOR_BASE_URL, CURSOR_LOGIN_HINT, CURSOR_PROVIDER_ID, CURSOR_PROVIDER_NAME, catalogFailure, cursorCatalogHeaders, parseUsableModels, toPiModel, usableModelsUrl } from './catalog.ts';
import { type AgentRunner, createCursorStreams, runCursorAgent } from './stream.ts';

export type CursorDeps = {
  readonly readSession?: () => Promise<OAuthCredential | undefined>;
  readonly runLogin?: (signal: AbortSignal) => Promise<void>;
  readonly runAgent?: AgentRunner;
};

export function createCursorProvider(deps: CursorDeps = {}): Provider {
  const readSession = deps.readSession ?? (() => readKeychainCredential());
  const runLogin = deps.runLogin ?? runCursorAgentLogin;
  const streams = createCursorStreams(deps.runAgent ?? runCursorAgent);
  const oauth = {
    name: CURSOR_PROVIDER_NAME,
    isSubscription: true,
    loginLabel: 'Sign in with Cursor',
    login: (interaction: ProviderAuthInteraction) => loginCursor(interaction.signal, readSession, runLogin),
    refresh: (_credential: OAuthCredential, signal: AbortSignal) => refreshCursor(signal, readSession),
    toAuth: async (credential: { access: string }) => ({ apiKey: credential.access }),
  };

  const fetchModels = async (context: RefreshModelsContext) => {
    if (context.credential?.type !== 'oauth') throw new Error(CURSOR_LOGIN_HINT);
    const { apiKey } = await oauth.toAuth(context.credential);
    if (!apiKey) throw new Error(CURSOR_LOGIN_HINT);
    const baseUrl = (context.baseUrl ?? CURSOR_BASE_URL).replace(/\/+$/, '');
    const response = await fetch(usableModelsUrl(baseUrl), { method: 'POST', headers: cursorCatalogHeaders(apiKey), body: '{}', redirect: 'error', signal: context.signal });
    if (!response.ok) throw catalogFailure(response.status);
    const parsed = parseUsableModels(await response.json().catch(() => undefined));
    if (parsed.kind === 'unreadable') throw new Error('Cursor returned a model list Pi cannot read.');
    return parsed.models.map((model) => toPiModel(model, baseUrl));
  };

  return createProvider({
    id: CURSOR_PROVIDER_ID,
    name: CURSOR_PROVIDER_NAME,
    baseUrl: CURSOR_BASE_URL,
    auth: { oauth },
    models: BASELINE.map((model) => toPiModel(model)),
    fetchModels,
    api: streams,
  });
}
