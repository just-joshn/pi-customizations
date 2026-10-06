// Proves the claude-subscription context guard on the real RPC surface.
//
// The probe seeds a session on a second provider (`probe-foreign`) whose
// endpoint reports usage for a tokenizer that counts the same text more
// cheaply, then switches to claude-subscription. Pi's estimate trusts the
// foreign usage and stays below its own threshold, while Anthropic's tokenizer
// sees a request over the model window.
//
// RED (before the guard): the endpoint rejects the prompt with `prompt is too
// long`, the overflow-recovery summarization request is itself over the window
// (it serializes the whole foreign-grown session), and no compaction entry
// lands, so a second prompt wedges the same way.
// GREEN (with the guard): the guard compacts before the request, each
// summarization piece fits, no request exceeds the window, and the run carries
// the compaction summary.
//
// Usage:
//   node --experimental-strip-types scripts/prove-context-guard.ts --expect red
//   PI_OAUTH_CLI_PATH=<install>/dist/bundle/cli.js node --experimental-strip-types scripts/prove-context-guard.ts --expect green
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { RpcClient } from '@earendil-works/pi-coding-agent';
import { oauthCredential } from '../test/support/credentials.ts';
import { type RecordedRequest, startMessagesServer } from '../test/support/messages-server.ts';
import { isRecord, messagesOf, systemTexts } from '../test/support/request-body.ts';
import { frames, textMessage } from '../test/support/sse.ts';

const PROVIDER = 'claude-subscription';
const MODEL = 'claude-opus-5-5';
const MODEL_REFERENCE = `${PROVIDER}/${MODEL}`;
const FOREIGN_PROVIDER = 'probe-foreign';
const FOREIGN_MODEL = 'probe-foreign-1';
// The probe pins the subscription model window to 200k so the fixture prompts
// stay small. The foreign provider keeps a 1M window.
const CONTEXT_WINDOW = 200_000;
// The endpoint's tokenizer. Claude Code's bytesPerToken for claude-opus-5-5.
const WIRE_BYTES_PER_TOKEN = 3;
// The tokenizer of the foreign provider whose usage Pi's baseline trusts.
const FOREIGN_BYTES_PER_TOKEN = 4.5;
const SUMMARIZATION_SYSTEM = 'You are a context summarization assistant.';
const COMPACTION_MARKER = 'The conversation history before this point was compacted into the following summary:';
const FOREIGN_PROMPT_BYTES = 350_000;
const CLAUDE_PROMPT = 'switch to claude';
const PROMPT_FILLER = 'The quick brown fox jumps over the lazy dog. ';
const PROMPT_TIMEOUT_MS = 120_000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const extension = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const cliPath = process.env['PI_OAUTH_CLI_PATH'] ?? join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');

type Expectation = 'red' | 'green';

interface Attempt {
  readonly index: number;
  readonly wireModel: string;
  readonly capped: boolean;
  readonly wireTokens: number;
  readonly summarization: boolean;
  readonly compactionSummary: boolean;
  readonly status: number;
  readonly rejection: string | null;
  readonly violations: readonly string[];
  readonly messages: readonly string[];
}

function expectation(): Expectation {
  const args = process.argv.slice(2);
  const index = args.indexOf('--expect');
  const value = index < 0 ? undefined : args[index + 1];
  if (value !== 'red' && value !== 'green') throw new Error('Usage: prove-context-guard.ts --expect red|green');
  return value;
}

function filler(label: string, bytes: number): string {
  const repeats = Math.ceil(bytes / Buffer.byteLength(PROMPT_FILLER, 'utf8'));
  return `${label}\n${PROMPT_FILLER.repeat(repeats)}`;
}

function wireTokens(body: unknown): number {
  return Math.round(Buffer.byteLength(JSON.stringify(body), 'utf8') / WIRE_BYTES_PER_TOKEN);
}

function contentBlocks(message: Record<string, unknown>): readonly unknown[] {
  const content = message['content'];
  if (typeof content === 'string') return [content];
  return Array.isArray(content) ? content : [];
}

// Anthropic rejects a payload whose first message is not user, whose
// tool_result has no preceding tool_use, or that appends content after a
// tool_result, or that carries more than four cache breakpoints. A fit that
// breaks them must fail the probe, not pass it.
function payloadViolations(body: unknown): readonly string[] {
  if (!isRecord(body)) return ['body is not an object'];
  const messages = messagesOf(body);
  if (messages.length === 0) return ['messages is empty'];
  const violations: string[] = [];
  const markers = [...JSON.stringify(body).matchAll(/"cache_control"/g)].length;
  if (markers > 4) violations.push(`the payload carries ${markers} cache breakpoints`);
  const first = messages[0];
  if (!isRecord(first) || first['role'] !== 'user') violations.push('the first message is not user');
  const toolUses = new Set<string>();
  messages.forEach((message, index) => {
    if (!isRecord(message)) {
      violations.push(`message ${index} is not an object`);
      return;
    }
    const role = message['role'];
    if (role !== 'user' && role !== 'assistant' && role !== 'system') violations.push(`message ${index} has an unknown role`);
    const content = message['content'];
    if (typeof content === 'string') return;
    if (!Array.isArray(content)) {
      violations.push(`message ${index} has non-string, non-array content`);
      return;
    }
    let sawToolResult = false;
    for (const block of content) {
      if (!isRecord(block)) {
        violations.push(`message ${index} has a non-object content block`);
        continue;
      }
      const type = block['type'];
      if (type === 'tool_use' && typeof block['id'] === 'string') toolUses.add(block['id']);
      if (type === 'tool_result') {
        sawToolResult = true;
        const id = block['tool_use_id'];
        if (typeof id !== 'string' || !toolUses.has(id)) violations.push(`message ${index} has a tool_result without a preceding tool_use`);
      }
      if (sawToolResult && type !== 'tool_result') violations.push(`message ${index} has content after a tool_result`);
    }
  });
  return violations;
}

function summarizeMessage(message: unknown): string {
  if (!isRecord(message)) return '<not an object>';
  const role = typeof message['role'] === 'string' ? message['role'] : 'unknown';
  const text = contentBlocks(message)
    .map((block) => (typeof block === 'string' ? block : isRecord(block) && typeof block['text'] === 'string' ? block['text'] : `<${String(isRecord(block) ? block['type'] : typeof block)}>`))
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${role}: ${text.length > 120 ? `${text.slice(0, 120)}...` : text}`;
}

const attempts: Attempt[] = [];

function gatewayReply(res: ServerResponse, request: RecordedRequest): void {
  const body = request.body;
  const wire = wireTokens(body);
  const wireModel = isRecord(body) && typeof body['model'] === 'string' ? body['model'] : '<none>';
  const capped = wireModel === MODEL;
  const summarization = systemTexts(body).some((text) => text.includes(SUMMARIZATION_SYSTEM));
  const compactionSummary = JSON.stringify(body).includes(COMPACTION_MARKER);
  const violations = payloadViolations(body);
  const base = { index: attempts.length, wireModel, capped, wireTokens: wire, summarization, compactionSummary, messages: messagesOf(body).map(summarizeMessage) };
  if (violations.length > 0) {
    const rejection = `invalid request payload: ${violations.join('; ')}`;
    attempts.push({ ...base, status: 400, rejection, violations });
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: rejection } }));
    return;
  }
  if (capped && wire > CONTEXT_WINDOW) {
    const rejection = `prompt is too long: ${wire} tokens > ${CONTEXT_WINDOW} maximum`;
    attempts.push({ ...base, status: 400, rejection, violations });
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: rejection } }));
    return;
  }
  attempts.push({ ...base, status: 200, rejection: null, violations });
  const foreign = Math.round((wire * WIRE_BYTES_PER_TOKEN) / FOREIGN_BYTES_PER_TOKEN);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(frames(textMessage('ok', { input_tokens: foreign, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })));
}

interface PromptRun {
  readonly error: string | null;
  readonly events: readonly { readonly type: string; readonly message?: unknown }[];
}

function assistantErrors(events: readonly { readonly type: string; readonly message?: unknown }[]): readonly string[] {
  return events.flatMap((event) => {
    if (event.type !== 'message_end' || !isRecord(event.message)) return [];
    const message = event.message;
    if (message['role'] !== 'assistant' || message['stopReason'] !== 'error') return [];
    return [typeof message['errorMessage'] === 'string' ? message['errorMessage'] : ''];
  });
}

function assistantStops(events: readonly { readonly type: string; readonly message?: unknown }[]): readonly string[] {
  return events.flatMap((event) => {
    if (event.type !== 'message_end' || !isRecord(event.message)) return [];
    const message = event.message;
    return message['role'] === 'assistant' && typeof message['stopReason'] === 'string' ? [message['stopReason']] : [];
  });
}

async function prompt(client: RpcClient, message: string): Promise<PromptRun> {
  try {
    return { error: null, events: await client.promptAndWait(message, undefined, PROMPT_TIMEOUT_MS) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), events: [] };
  }
}

function report(): void {
  process.stdout.write('\n=== RECORDED REQUESTS ===\n');
  for (const attempt of attempts) {
    process.stdout.write(
      `${JSON.stringify({
        index: attempt.index,
        kind: attempt.summarization ? 'summarization' : 'agent-prompt',
        model: attempt.wireModel,
        capped: attempt.capped,
        wireTokens: attempt.wireTokens,
        cap: CONTEXT_WINDOW,
        status: attempt.status,
        rejection: attempt.rejection,
        compactionSummary: attempt.compactionSummary,
        violations: attempt.violations,
      })}\n`,
    );
    for (const message of attempt.messages) process.stdout.write(`    ${message}\n`);
  }
}

const expected = expectation();

const root = await mkdtemp(join(tmpdir(), 'pi-oauth-context-guard-'));
const server = await startMessagesServer(gatewayReply);
const { stdout: cliVersion } = await promisify(execFile)(process.execPath, [cliPath, '--version']);

try {
  const agentDir = join(root, 'agent');
  const cwd = join(root, 'cwd');
  await Promise.all([mkdir(agentDir), mkdir(cwd)]);
  await Promise.all([
    writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [PROVIDER]: oauthCredential({ expires: Date.now() + YEAR_MS }) }), { mode: 0o600 }),
    writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          [PROVIDER]: { baseUrl: server.baseUrl, modelOverrides: { [MODEL]: { contextWindow: CONTEXT_WINDOW } } },
          [FOREIGN_PROVIDER]: {
            baseUrl: server.baseUrl,
            api: 'anthropic-messages',
            apiKey: 'probe',
            models: [{ id: FOREIGN_MODEL, name: 'Probe foreign', contextWindow: 1_000_000, maxTokens: 8_192 }],
          },
        },
      }),
    ),
    writeFile(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 1 } })),
  ]);

  const client = new RpcClient({
    cliPath,
    cwd,
    env: { PI_CODING_AGENT_DIR: agentDir, PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' },
    args: ['--offline', '--no-session', '-ne', '-ns', '-np', '-nc', '-e', extension],
    model: MODEL_REFERENCE,
  });
  await client.start();
  let first: PromptRun;
  let second: PromptRun;
  try {
    if (!(await client.setModel(FOREIGN_PROVIDER, FOREIGN_MODEL))) throw new Error(`${FOREIGN_PROVIDER}/${FOREIGN_MODEL} is not registered`);
    await prompt(client, filler('foreign one', FOREIGN_PROMPT_BYTES));
    await prompt(client, filler('foreign two', FOREIGN_PROMPT_BYTES));
    if (!(await client.setModel(PROVIDER, MODEL))) throw new Error(`${PROVIDER}/${MODEL} is not registered`);
    first = await prompt(client, CLAUDE_PROMPT);
    second = await prompt(client, 'second claude prompt');
  } finally {
    await client.stop();
  }

  report();
  process.stdout.write(`\n=== PROMPTS ===\n${JSON.stringify({ first: { error: first.error, assistantErrors: assistantErrors(first.events) }, second: { error: second.error, assistantErrors: assistantErrors(second.events) } })}\n`);
  process.stdout.write(`\n=== VERDICT (${expected}, cli ${cliVersion.trim()}) ===\n`);

  const failures: string[] = [];
  const claudeAttempts = attempts.filter((attempt) => attempt.capped);
  const rejections = attempts.flatMap((attempt) => (attempt.rejection?.startsWith('prompt is too long:') === true ? [attempt.rejection] : []));
  if (attempts.some((attempt) => attempt.violations.length > 0)) failures.push('the endpoint saw an invalid Anthropic payload');
  if (attempts.filter((attempt) => !attempt.capped && attempt.status === 200).length < 2) failures.push('the foreign seeding prompts were not both accepted');
  if (expected === 'red') {
    if (claudeAttempts.every((attempt) => attempt.wireTokens <= CONTEXT_WINDOW)) failures.push(`RED expected a subscription request over ${CONTEXT_WINDOW} tokens`);
    if (rejections.length === 0) failures.push('RED expected a "prompt is too long" rejection');
    if (rejections.some((rejection) => !/^prompt is too long: \d+ tokens > \d+ maximum$/.test(rejection))) failures.push('RED saw a rejection that is not the recorded error shape');
    if (!attempts.some((attempt) => attempt.summarization && attempt.rejection !== null)) failures.push('RED expected the overflow summarization request to be rejected');
    if (attempts.some((attempt) => attempt.compactionSummary)) failures.push('RED expected no compaction summary before the guard');
    if (!assistantErrors(first.events).some((message) => message.includes('prompt is too long'))) failures.push('RED expected the first subscription prompt to surface the "prompt is too long" error');
    if (!assistantErrors(second.events).some((message) => message.includes('prompt is too long'))) failures.push('RED expected the second subscription prompt to fail the same way');
  } else {
    if (claudeAttempts.some((attempt) => attempt.wireTokens > CONTEXT_WINDOW)) failures.push('GREEN expected no subscription request over the window');
    if (rejections.length > 0) failures.push('GREEN expected no endpoint rejection');
    if (!attempts.some((attempt) => attempt.summarization && attempt.rejection === null)) failures.push('GREEN expected an accepted summarization request');
    if (!attempts.some((attempt) => attempt.capped && !attempt.summarization && attempt.compactionSummary)) failures.push('GREEN expected the run to carry the compaction summary');
    if (!assistantStops(first.events).includes('stop')) failures.push('GREEN expected the first prompt to settle with a stop');
    if (!assistantStops(second.events).includes('stop')) failures.push('GREEN expected the second prompt to settle with a stop');
    if (assistantErrors(first.events).length + assistantErrors(second.events).length > 0) failures.push('GREEN expected the run to settle without an error');
  }

  if (failures.length > 0) {
    for (const failure of failures) process.stdout.write(`FAIL ${failure}\n`);
    process.exitCode = 1;
  } else if (expected === 'red') {
    process.stdout.write('PASS the endpoint rejected the subscription prompts and the overflow summarization, and no compaction landed\n');
  } else {
    process.stdout.write('PASS the guard compacted before the run, every subscription request stayed under the window, and the run carried the summary\n');
  }
} finally {
  await server.close();
  await rm(root, { recursive: true, force: true });
}
