import { createServer } from 'node:http';

import { expect, vi } from 'vitest';
import { test } from './network-guard.ts';

const dateNow = Date.now;
const originalEnv = process.env['PI_OAUTH_TEST_GUARD'];

test.for([
  { name: 'string', input: 'https://example.invalid/blocked' },
  { name: 'URL', input: new URL('https://example.invalid/blocked') },
  { name: 'Request', input: new Request('https://example.invalid/blocked') },
])('a $name request cannot reach an external host', async ({ input }) => {
  await expect(fetch(input)).rejects.toThrow('Blocked external network request to https://example.invalid/blocked');
});

test('a loopback request reaches the local server', async ({ onTestFinished }) => {
  const server = createServer((_, response) => response.end('local response'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback listener');
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  expect(await response.text()).toBe('local response');
});

test('a loopback response does not follow redirects', async ({ onTestFinished }) => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/target' });
    }
    response.end('local response');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback listener');
  await expect(fetch(`http://127.0.0.1:${address.port}/redirect`, { redirect: 'follow' })).rejects.toThrow();
  expect(paths).toStrictEqual(['/redirect']);
});

test.for(['first', 'second'])('the %s test starts with restored process state', async (_, { networkGuard }) => {
  expect(globalThis.fetch).toBe(networkGuard);
  expect(Date.now).toBe(dateNow);
  expect(process.env['PI_OAUTH_TEST_GUARD']).toBe(originalEnv);
  expect(vi.isFakeTimers()).toBe(false);
  await expect(fetch('https://example.invalid/blocked')).rejects.toThrow('Blocked external network request');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ local: true })));
  vi.stubEnv('PI_OAUTH_TEST_GUARD', 'test-owned');
  vi.spyOn(Date, 'now').mockReturnValue(123);
  vi.useFakeTimers();
});
