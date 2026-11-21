import type { AuthEvent, AuthPrompt, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { vi } from 'vitest';
import { EXPIRES_IN_SECONDS, ROUTE_LOAD, ROUTE_TOKEN } from './constants.ts';
import { type GoogleFake, installGoogle, json, type Routes } from './google.ts';
import { loadProvider, oauthOf } from './session.ts';

export const AUTH_CODE = 'auth-code';
const ENV_PROJECT_KEYS = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT_ID'] as const;

/** The Google answers of a healthy account: a token exchange and an onboarded Pro account. */
export const healthyGoogle: Routes = {
  [ROUTE_TOKEN]: () => json({ access_token: 'access-new', expires_in: EXPIRES_IN_SECONDS, refresh_token: 'refresh-new' }),
  [ROUTE_LOAD]: () => json({ currentTier: { id: 'g1-pro-tier', name: 'Google AI Pro' }, cloudaicompanionProject: 'proj-server' }),
};

/** Sets the project env vars the user's shell would carry on the real `process.env`, clearing the ones not given. */
export function stubProjectEnv(env: Partial<Record<(typeof ENV_PROJECT_KEYS)[number], string>> = {}): void {
  for (const key of ENV_PROJECT_KEYS) vi.stubEnv(key, env[key]);
}

export const waitsForAbort = (prompt: AuthPrompt) =>
  new Promise<string>((_resolve, reject) => {
    prompt.signal?.addEventListener('abort', () => reject(new Error('prompt aborted')), { once: true });
  });

export type PromptImpl = (prompt: AuthPrompt) => Promise<string>;

function interaction(promptImpl: PromptImpl) {
  const urlShown = Promise.withResolvers<void>();
  const notify = vi.fn<(event: AuthEvent) => void>((event) => {
    if (event.type === 'auth_url') urlShown.resolve();
  });
  const prompt = vi.fn(promptImpl);
  const controller = new AbortController();
  const value: ProviderAuthInteraction = { signal: controller.signal, prompt, notify };
  return {
    value,
    controller,
    urlShown: urlShown.promise,
    get events(): AuthEvent[] {
      return notify.mock.calls.map(([event]) => event);
    },
    get prompts(): AuthPrompt[] {
      return prompt.mock.calls.map(([request]) => request);
    },
  };
}

export const authUrl = (events: AuthEvent[]): URL | undefined => {
  const event = events.find((candidate) => candidate.type === 'auth_url');
  return event?.type === 'auth_url' ? new URL(event.url) : undefined;
};

export interface LoginSession {
  controller: AbortController;
  google: GoogleFake;
  result: Promise<OAuthCredential>;
  events: AuthEvent[];
  prompts: AuthPrompt[];
  /** Where Google would redirect the browser after the user signs in. */
  redirectUri: string;
  /** Hits the loopback listener the way the browser does and returns the listener's answer. */
  browserCallback(query: string): Promise<Response>;
}

export interface LoginOptions {
  routes?: Routes;
  env?: Parameters<typeof stubProjectEnv>[0];
  signal?: AbortSignal;
}

/** Starts a real Pi login through the registered provider without waiting for anything. */
export function beginLogin(promptImpl: PromptImpl, options: LoginOptions = {}) {
  stubProjectEnv(options.env);
  const google = installGoogle({ ...healthyGoogle, ...options.routes });
  const session = interaction(promptImpl);
  const result = oauthOf(loadProvider()).login(options.signal ? { ...session.value, signal: options.signal } : session.value);
  result.catch(() => undefined);
  return { session, google, result };
}

/** Starts a login and waits until the sign-in URL is shown. */
export async function startLogin(promptImpl: PromptImpl, options: LoginOptions = {}): Promise<LoginSession> {
  const { session, google, result } = beginLogin(promptImpl, options);
  await session.urlShown;
  const url = authUrl(session.events);
  const redirectUri = url?.searchParams.get('redirect_uri') ?? '';
  const state = url?.searchParams.get('state') ?? '';
  return {
    controller: session.controller,
    google,
    result,
    redirectUri,
    browserCallback: (query) => fetch(`${redirectUri}?state=${state}&${query}`),
    get events(): AuthEvent[] {
      return session.events;
    },
    get prompts(): AuthPrompt[] {
      return session.prompts;
    },
  };
}

/** Signs in by pasting the code, the path that needs no browser. */
export const signInByPaste = (options: LoginOptions = {}, code = 'pasted-code') => startLogin(async () => code, options);

export const tokenRequest = (login: LoginSession) => login.google.requestsTo(ROUTE_TOKEN)[0]?.form;
