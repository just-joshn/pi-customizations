import type { ClientOptions } from '@anthropic-ai/sdk';
import type { Api, Model } from '@earendil-works/pi-ai';
import { REQUEST_CONFIG } from './config.ts';

export const isOAuthToken = (apiKey: string): boolean => apiKey.includes(REQUEST_CONFIG.oauthTokenMarker);

export function buildClientOptions(model: Model<Api>, apiKey: string, isOAuth: boolean): ClientOptions {
  if (isOAuth) return { baseURL: model.baseUrl, authToken: apiKey, defaultHeaders: { ...REQUEST_CONFIG.oauthHeaders } };
  return { baseURL: model.baseUrl, apiKey };
}
