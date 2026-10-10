import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import type { ExecOutcome } from '../../src/core/host.ts';
import { createHost } from '../../src/core/pi-host.ts';
import { piSessionFixture } from '../support/pi-session.ts';

function nativeHost(pi: ExtensionAPI, ctx: ExtensionContext) {
  return createHost(pi, { context: () => ctx, yes: () => null, never: () => [], remember: () => {}, environment: () => ({ TEST_VALUE: 'value with spaces; $(not-a-shell)' }), notice: () => {} });
}

test('native exec receives an isolated literal command environment', async () => {
  let result: ExecOutcome | undefined;
  const before = process.env['TEST_VALUE'];
  const f = await piSessionFixture({
    extension: (pi) => {
      pi.registerCommand('probe-env', {
        description: 'test environment',
        handler: async (_args, ctx) => {
          result = await nativeHost(pi, ctx).exec({ command: '/usr/bin/env', args: [], cwd: ctx.cwd });
        },
      });
    },
  });
  const session = await f.open();
  await session.prompt('/probe-env');
  expect(result).toEqual({ stdout: 'TEST_VALUE=value with spaces; $(not-a-shell)\n', stderr: '', code: 0, killed: false });
  expect(process.env['TEST_VALUE']).toBe(before);
  expect(f.requests).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test('native exec cancellation terminates a running child', async () => {
  let result: ExecOutcome | undefined;
  const f = await piSessionFixture({
    extension: (pi) => {
      pi.registerCommand('probe-cancel', {
        description: 'test cancellation',
        handler: async (_args, ctx) => {
          const abort = new AbortController();
          const running = nativeHost(pi, ctx).exec({ command: '/bin/sleep', args: ['60'], cwd: ctx.cwd, signal: abort.signal });
          abort.abort();
          result = await running;
        },
      });
    },
  });
  const session = await f.open();
  await session.prompt('/probe-cancel');
  expect(result?.killed).toBe(true);
  expect(f.requests).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test('print-mode host selection does not invent user consent', async () => {
  let selected: string | undefined;
  let confirmed = true;
  const f = await piSessionFixture({
    extension: (pi) => {
      pi.registerCommand('probe-ui', {
        description: 'test no UI',
        handler: async (_args, ctx) => {
          const host = nativeHost(pi, ctx);
          selected = await host.select('Choose', ['yes', 'no']);
          confirmed = await host.confirm({ question: 'May I write?', defaultAnswer: 'y' });
        },
      });
    },
  });
  const session = await f.open();
  await session.prompt('/probe-ui');
  expect(selected).toBeUndefined();
  expect(confirmed).toBe(false);
  expect(f.errors).toEqual([]);
});
