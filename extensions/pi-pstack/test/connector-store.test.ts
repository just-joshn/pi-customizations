import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';
import { credentialPath, readCredential, writeCredential } from '../src/connector-store.ts';
import { slackToken } from '../src/slack/client.ts';

function store(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-connector-store-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', dir);
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('updating a connector field preserves its other fields and leaves no temporary file', () => {
  const dir = store();
  writeCredential('slack', 'token', 'fixture-old');
  writeCredential('slack', 'channel', 'fixture-channel');
  const path = writeCredential('slack', 'token', 'fixture-new');
  expect(path).toBe(join(dir, 'pstack/connectors/slack/credentials.json'));
  expect(readCredential('slack', 'token')).toBe('fixture-new');
  expect(readCredential('slack', 'channel')).toBe('fixture-channel');
  expect(readdirSync(dirname(path))).toEqual(['credentials.json']);
});

test('connector directories and credentials remain private to the user', () => {
  store();
  const path = writeCredential('slack', 'token', 'fixture-only');
  expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('missing, empty, and non-string credential fields have no value', () => {
  store();
  expect(readCredential('slack', 'token')).toBeUndefined();
  writeCredential('slack', 'token', '');
  expect(readCredential('slack', 'token')).toBeUndefined();
  writeFileSync(credentialPath('slack'), '{"token":42}\n');
  expect(readCredential('slack', 'token')).toBeUndefined();
});

test.for([
  { connector: '../escape', field: 'token', message: /connector must be/ },
  { connector: 'Slack', field: 'token', message: /connector must be/ },
  { connector: 'slack', field: '../token', message: /field must be/ },
])('invalid connector or field names are rejected before writing $connector/$field', ({ connector, field, message }) => {
  const dir = store();
  expect(() => writeCredential(connector, field, 'fixture-only')).toThrow(message);
  expect(readdirSync(dir)).toEqual([]);
});

test('Slack reads the connector store and still prefers environment credentials', () => {
  store();
  writeCredential('slack', 'token', 'fixture-stored');
  expect(slackToken({})).toBe('fixture-stored');
  expect(slackToken({ SLACK_BOT_TOKEN: 'fixture-environment' })).toBe('fixture-environment');
  writeFileSync(credentialPath('slack'), 'malformed');
  expect(slackToken({})).toBeUndefined();
});
