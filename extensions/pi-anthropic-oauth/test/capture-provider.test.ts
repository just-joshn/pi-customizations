import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import extension from '../src/index.ts';
import { captureProvider } from './support/load-extension.ts';

const sample = captureProvider(extension);

test('captureProvider returns the one registered provider', () => {
  expect(captureProvider((pi) => pi.registerProvider(sample))).toBe(sample);
});

test('captureProvider rejects a factory that registers nothing', () => {
  expect(() => captureProvider(() => undefined)).toThrow('expected one native provider registration, received 0');
});

test('captureProvider rejects a factory that registers two providers', () => {
  expect(() =>
    captureProvider((pi) => {
      pi.registerProvider(sample);
      pi.registerProvider(sample);
    }),
  ).toThrow('expected one native provider registration, received 2');
});

test('captureProvider rejects the legacy string form', () => {
  const legacy: Parameters<ExtensionAPI['registerProvider']>[1] = { baseUrl: 'http://127.0.0.1' };
  expect(() => captureProvider((pi) => pi.registerProvider('legacy', legacy))).toThrow('legacy registerProvider("legacy", config) is not supported');
});
