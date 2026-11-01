import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import {
  AUTHORIZATION_CODE_RESPONSE_SHAPE,
  assertLiveExchangeAllowed,
  assertTokenJsonShape,
  buildLiveExchangeReceipt,
  isLiveExchangeEnvEnabled,
  LIVE_EXCHANGE_ENV,
  LIVE_EXCHANGE_GATE_ID,
  parseLiveExchangeGateStatus,
} from '../src/oauth-live-gate.ts';

const FIXTURE = join(
  fileURLToPath(new URL('../../../parity/oauth-rea-2026-10-31/claude/fixtures', import.meta.url)),
  'token-endpoints-2.1.312.json',
);
const GATES = join(fileURLToPath(new URL('../../../parity/oauth-rea-2026-10-31/claude', import.meta.url)), 'gates.md');
const EXAMPLE_RECEIPT = join(
  fileURLToPath(new URL('../../../parity/oauth-rea-2026-10-31/claude/receipts', import.meta.url)),
  'live-exchange-redacted.example.json',
);

test('CI default leaves the live exchange env disabled', () => {
  expect(isLiveExchangeEnvEnabled({})).toBe(false);
  expect(isLiveExchangeEnvEnabled({ [LIVE_EXCHANGE_ENV]: '0' })).toBe(false);
  expect(isLiveExchangeEnvEnabled({ [LIVE_EXCHANGE_ENV]: '1' })).toBe(true);
  expect(isLiveExchangeEnvEnabled({ [LIVE_EXCHANGE_ENV]: 'true' })).toBe(true);
});

test('gates.md parks ANTH-LIVE-021 until an operator approves it', async () => {
  const markdown = await readFile(GATES, 'utf8');
  expect(parseLiveExchangeGateStatus(markdown)).toBe('parked');
  expect(() => assertLiveExchangeAllowed({ env: { [LIVE_EXCHANGE_ENV]: '1' }, gatesMarkdown: markdown })).toThrow(
    /status is "parked"/,
  );
});

test('live exchange requires both the env flag and an approved gates.md section', () => {
  const approved = `## ${LIVE_EXCHANGE_GATE_ID}\n\n- status: approved\n`;
  expect(() => assertLiveExchangeAllowed({ env: {}, gatesMarkdown: approved })).toThrow(
    new RegExp(LIVE_EXCHANGE_ENV),
  );
  expect(() => assertLiveExchangeAllowed({ env: { [LIVE_EXCHANGE_ENV]: '1' }, gatesMarkdown: approved })).not.toThrow();
});

test('token JSON shape matches Claude token-endpoints fixture response fields', async () => {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
    authorization_code_response_fields: {
      required: readonly string[];
      optional: readonly string[];
    };
  };
  expect(fixture.authorization_code_response_fields.required).toStrictEqual([
    ...AUTHORIZATION_CODE_RESPONSE_SHAPE.required,
  ]);
  expect(fixture.authorization_code_response_fields.optional).toStrictEqual([
    ...AUTHORIZATION_CODE_RESPONSE_SHAPE.optional,
  ]);

  const shaped = assertTokenJsonShape(
    {
      access_token: 'sk-ant-oat01-example',
      refresh_token: 'sk-ant-ort01-example',
      expires_in: 3600,
      refresh_token_expires_in: 2_592_000,
    },
    fixture.authorization_code_response_fields,
  );
  expect(shaped.expires_in).toBe(3600);
  expect(shaped.refresh_token).toBe('sk-ant-ort01-example');

  expect(() =>
    assertTokenJsonShape({ access_token: 'x', expires_in: 3600 }, fixture.authorization_code_response_fields),
  ).toThrow(/refresh_token/);
  expect(() =>
    assertTokenJsonShape(
      { access_token: 'x', expires_in: '3600', refresh_token: 'y' },
      fixture.authorization_code_response_fields,
    ),
  ).toThrow(/expires_in/);
});

test('redacted receipt omits secret values and keeps lengths plus numeric fields', async () => {
  const receipt = buildLiveExchangeReceipt({
    httpStatus: 200,
    probedAt: '2026-11-01T00:00:00.000Z',
    body: {
      access_token: 'sk-ant-oat01-aaaaaaaa',
      refresh_token: 'sk-ant-ort01-bbbbbbbb',
      expires_in: 3600,
      refresh_token_expires_in: 2_592_000,
    },
  });
  expect(receipt.unit).toBe(LIVE_EXCHANGE_GATE_ID);
  expect(receipt.http_status).toBe(200);
  expect(receipt.shape_ok).toBe(true);
  expect(receipt.response.access_token).toStrictEqual({ present: true, length: 21, redacted: '[redacted]' });
  expect(receipt.response.refresh_token).toStrictEqual({ present: true, length: 21, redacted: '[redacted]' });
  expect(receipt.response.expires_in).toBe(3600);
  expect(JSON.stringify(receipt)).not.toContain('sk-ant-oat01-aaaaaaaa');
  expect(JSON.stringify(receipt)).not.toContain('sk-ant-ort01-bbbbbbbb');

  const example = JSON.parse(await readFile(EXAMPLE_RECEIPT, 'utf8')) as typeof receipt;
  expect(example.unit).toBe(LIVE_EXCHANGE_GATE_ID);
  expect(example.shape_ok).toBe(true);
  expect(JSON.stringify(example)).not.toMatch(/sk-ant-/);

  const dir = await mkdtemp(join(tmpdir(), 'oauth-live-receipt-'));
  const path = join(dir, 'live-exchange-redacted.json');
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
  const written = JSON.parse(await readFile(path, 'utf8')) as typeof receipt;
  expect(written.response.keys).toStrictEqual([
    'access_token',
    'expires_in',
    'refresh_token',
    'refresh_token_expires_in',
  ]);
});
