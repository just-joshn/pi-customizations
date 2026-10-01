import { expect, vi } from 'vitest';
import { ask } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { soleRequest } from './support/request-body.ts';
import { collect } from './support/run-stream.ts';

const DEFAULT_AGENT = 'claude-cli/2.1.280';

test('options.env sets the user agent version', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: '9.9.9' } }));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', 'claude-cli/9.9.9');
});

test('process.env sets the user agent version', async ({ models, model, server }) => {
  vi.stubEnv('CLAUDE_CODE_VERSION', '8.8.8');
  await collect(models.streamSimple(model, ask('hi')));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', 'claude-cli/8.8.8');
});

test('options.env wins over process.env', async ({ models, model, server }) => {
  vi.stubEnv('CLAUDE_CODE_VERSION', '8.8.8');
  await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: '9.9.9' } }));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', 'claude-cli/9.9.9');
});

test('an empty options.env value falls back to process.env', async ({ models, model, server }) => {
  vi.stubEnv('CLAUDE_CODE_VERSION', '8.8.8');
  await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: '' } }));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', 'claude-cli/8.8.8');
});

test('empty values everywhere keep the default user agent', async ({ models, model, server }) => {
  vi.stubEnv('CLAUDE_CODE_VERSION', '');
  await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: '' } }));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', DEFAULT_AGENT);
});

test.for([{ version: '2.1' }, { version: '2.1.280' }, { version: '1.2.3.4' }])('version $version is accepted', async ({ version }, { models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: version } }));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', `claude-cli/${version}`);
});

test('caller headers override the generated user agent', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, ask('hi'), { env: { CLAUDE_CODE_VERSION: '9.9.9' }, headers: { 'user-agent': 'custom-agent/1' } }));
  expect(soleRequest(server).headers).toHaveProperty('user-agent', 'custom-agent/1');
});
