import { expect, vi } from 'vitest';
import { ask } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { collect } from './support/run-stream.ts';

const FORMAT = 'CLAUDE_CODE_VERSION must be dotted digits with 2 to 4 groups, such as 2.1.280';

const invalid = [
  { name: 'a word', version: 'latest' },
  { name: 'a single group', version: '2' },
  { name: 'five groups', version: '1.2.3.4.5' },
  { name: 'a letter group', version: '2.1.x' },
  { name: 'leading whitespace', version: ' 2.1.280' },
  { name: 'a trailing newline', version: '2.1.280\n' },
  { name: 'an injected header', version: '2.1.280\r\nx-evil: 1' },
  { name: 'a negative group', version: '2.-1' },
];

test.for(invalid)('options.env with $name ends as an error result', async ({ version }, { models, model }) => {
  const { message } = await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: version } }));
  expect(message).toMatchObject({ stopReason: 'error', errorMessage: expect.stringContaining(FORMAT) });
});

test.for(invalid)('process.env with $name ends as an error result', async ({ version }, { models, model }) => {
  vi.stubEnv('CLAUDE_CODE_VERSION', version);
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(message).toMatchObject({ stopReason: 'error', errorMessage: expect.stringContaining(FORMAT) });
});

test('an invalid version sends no request', async ({ models, model, server }) => {
  const { message } = await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: 'latest' } }));
  expect(message.stopReason).toBe('error');
  expect(server.requests).toHaveLength(0);
});

test('the error message names the rejected value', async ({ models, model }) => {
  const { message } = await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: 'latest' } }));
  expect(message.errorMessage).toContain('"latest"');
});
