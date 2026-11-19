/**
 * Codex provider for Pi, built on @openai/codex-sdk.
 *
 * The Codex SDK drives the local Codex agent with the account you signed in to Codex with, such as your ChatGPT
 * plan. Each Pi request runs one Codex turn and shows Codex's final response.
 *
 * Usage:
 *   pi -e extensions/pi-openai-oauth
 *   /model openai-oauth/codex-default
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createCodex } from './codex.ts';
import { MODELS } from './models.ts';
import { createStreamCodex } from './stream.ts';

export const PROVIDER_ID = 'openai-oauth';

export default function (pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER_ID, {
    name: 'OpenAI Codex (ChatGPT sign-in)',
    // Codex holds the sign-in. Pi needs a key for a provider with models, so this literal stands in for it.
    baseUrl: 'codex://local',
    apiKey: 'codex-sign-in',
    api: 'openai-codex-sdk',
    models: MODELS,
    streamSimple: createStreamCodex(createCodex),
  });
}
