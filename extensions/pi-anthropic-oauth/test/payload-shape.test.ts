import { createModels, InMemoryCredentialStore, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import { expect, vi } from 'vitest';
import extension from '../src/index.ts';
import { test } from './network-guard.ts';
import { oauthCredential } from './support/credentials.ts';
import { captureProvider } from './support/load-extension.ts';
import { promptCarrying } from './support/payload-probe.ts';
import { BILLING_TEXT } from './support/request-body.ts';
import { collect, textOf } from './support/run-stream.ts';

vi.mock(import('@earendil-works/pi-ai/providers/all'), async (importOriginal) => {
  const actual = await importOriginal();
  const { probeStream, probeStreamSimple } = await import('./support/payload-probe.ts');
  return {
    ...actual,
    builtinProviders: () => actual.builtinProviders().map((provider) => (provider.id === 'anthropic' ? { ...provider, stream: probeStream, streamSimple: probeStreamSimple } : provider)),
  };
});

const BILLING = { type: 'text', text: BILLING_TEXT };
const NOTE = { type: 'text', text: 'note' };

async function send(payload: unknown, options: SimpleStreamOptions = {}) {
  const provider = captureProvider(extension);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => oauthCredential());
  const models = createModels({ credentials });
  models.setProvider(provider);
  const model = models.getModel(provider.id, 'claude-sonnet-4-6');
  if (!model) throw new Error('model is not registered');
  return collect(models.streamSimple(model, promptCarrying(payload), options));
}

const accepted = [
  { name: 'a system array', payload: { model: 'm', system: [NOTE] }, sent: { model: 'm', system: [BILLING, NOTE] } },
  { name: 'an empty system array', payload: { model: 'm', system: [] }, sent: { model: 'm', system: [BILLING] } },
  { name: 'an absent system', payload: { model: 'm' }, sent: { model: 'm', system: [BILLING] } },
  { name: 'an already attributed system', payload: { model: 'm', system: [BILLING, NOTE] }, sent: { model: 'm', system: [BILLING, NOTE] } },
];

test.for(accepted)('$name gets the billing block first', async ({ payload, sent }) => {
  const { message } = await send(payload);
  expect(JSON.parse(textOf(message))).toStrictEqual(sent);
});

const rejected = [
  { name: 'a null payload', payload: null, received: 'expected an object, received null' },
  { name: 'a string payload', payload: 'text', received: 'expected an object, received string' },
  { name: 'a number payload', payload: 42, received: 'expected an object, received number' },
  { name: 'an array payload', payload: [], received: 'expected an object, received array' },
  { name: 'a string system', payload: { system: 'text' }, received: 'expected system to be an array or absent, received string' },
  { name: 'a null system', payload: { system: null }, received: 'expected system to be an array or absent, received null' },
  { name: 'an object system', payload: { system: {} }, received: 'expected system to be an array or absent, received object' },
];

test.for(rejected)('$name ends as an error result', async ({ payload, received }) => {
  const { message } = await send(payload);
  expect(message).toMatchObject({ stopReason: 'error', errorMessage: `Unexpected request payload from Pi's anthropic provider: ${received}.` });
});

test('the caller onPayload never sees a rejected payload', async () => {
  const seen: unknown[] = [];
  const { message } = await send({ system: 'text' }, { onPayload: (payload) => void seen.push(payload) });
  expect(message.stopReason).toBe('error');
  expect(seen).toStrictEqual([]);
});
