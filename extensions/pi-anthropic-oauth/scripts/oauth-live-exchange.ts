#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';

import {
  buildAuthorizeUrl,
  CLAUDE_COPY_CODE_REDIRECT_URI,
  createPkcePair,
  exchangeAuthorizationCodeResult,
} from '../src/oauth.ts';
import {
  assertLiveExchangeAllowed,
  assertTokenJsonShape,
  buildLiveExchangeReceipt,
  LIVE_EXCHANGE_ENV,
  LIVE_EXCHANGE_GATE_ID,
  readLiveExchangeGateFile,
} from '../src/oauth-live-gate.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const GATES_PATH = join(ROOT, 'parity/oauth-rea-2026-10-31/claude/gates.md');
const RECEIPT_PATH = join(ROOT, 'parity/oauth-rea-2026-10-31/claude/receipts/live-exchange-redacted.json');
const LIVE_CODE_ENV = 'PI_ANTHROPIC_OAUTH_LIVE_CODE';

function parsePaste(value: string): { code: string; state?: string } {
  const trimmed = value.trim();
  if (trimmed.includes('#')) {
    const [code, state] = trimmed.split('#', 2);
    if (!code) throw new Error('Paste must look like code#state');
    return state ? { code, state } : { code };
  }
  if (trimmed.includes('code=')) {
    const params = new URLSearchParams(trimmed);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) throw new Error('Paste query string needs code=');
    return state ? { code, state } : { code };
  }
  return { code: trimmed };
}

async function readPaste(expectedState: string): Promise<{ code: string; state: string }> {
  const fromEnv = process.env[LIVE_CODE_ENV]?.trim();
  const raw =
    fromEnv && fromEnv.length > 0
      ? fromEnv
      : await (async () => {
          const rl = createInterface({ input, output });
          try {
            return await rl.question('Paste the Anthropic code (code#state): ');
          } finally {
            rl.close();
          }
        })();
  const parsed = parsePaste(raw);
  if (parsed.state && parsed.state !== expectedState) throw new Error('OAuth state mismatch');
  if (!parsed.code) throw new Error('Missing authorization code');
  return { code: parsed.code, state: parsed.state ?? expectedState };
}

async function main(): Promise<void> {
  const gatesMarkdown = await readLiveExchangeGateFile(GATES_PATH);
  assertLiveExchangeAllowed({ gatesMarkdown });

  const { verifier, challenge, state } = createPkcePair();
  const redirectUri = CLAUDE_COPY_CODE_REDIRECT_URI;
  const authorizeUrl = buildAuthorizeUrl({ challenge, state, redirectUri });
  console.error(`Open this authorize URL, then paste the code.`);
  console.error(authorizeUrl);
  console.error(`Gate ${LIVE_EXCHANGE_GATE_ID} is approved and ${LIVE_EXCHANGE_ENV} is set.`);

  const paste = await readPaste(state);
  const signal = AbortSignal.timeout(30_000);
  const exchanged = await exchangeAuthorizationCodeResult(
    { code: paste.code, state: paste.state, redirectUri, verifier },
    signal,
  );

  if (exchanged.httpStatus !== 200) {
    throw new Error(`Live token exchange returned HTTP ${exchanged.httpStatus}, expected 200`);
  }
  const token = assertTokenJsonShape(exchanged.body);
  const receipt = buildLiveExchangeReceipt({ body: token, httpStatus: exchanged.httpStatus });
  await mkdir(dirname(RECEIPT_PATH), { recursive: true });
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.error(`Wrote redacted receipt to ${RECEIPT_PATH}`);
  console.log(
    JSON.stringify({
      ok: true,
      receipt: RECEIPT_PATH,
      shape_ok: true,
      http_status: exchanged.httpStatus,
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
