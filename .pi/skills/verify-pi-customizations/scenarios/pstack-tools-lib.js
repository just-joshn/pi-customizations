import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = 'extensions/pi-pstack';
export const PROVIDER = fileURLToPath(new URL('./pstack-tools-provider.js', import.meta.url));
export const OBSERVER = fileURLToPath(new URL('./pstack-tools-observer.js', import.meta.url));
export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const SURFACES = 'docs/user-perspective-testing/surfaces.tsv';
const POLL_MS = 50;
const WAIT_MS = 30000;

export function packetPath(context) {
  return join(context.repoRoot, PACKAGE);
}

export function surfaceRows(context) {
  const lines = readFileSync(join(context.repoRoot, SURFACES), 'utf8').replace(/\n$/, '').split('\n');
  const columns = lines.shift().split('\t');
  return lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, line.split('\t')[index]])));
}

export function expectedFor(context, surfaceId) {
  const row = surfaceRows(context).find((candidate) => candidate.surface_id === surfaceId);
  if (!row) throw new Error(`surfaces.tsv has no row ${surfaceId}`);
  return row.expected;
}

export function assertSurface(context, { surfaceId, observed, evidence, check }) {
  context.receipts.assertVerdict({ surfaceId, package: PACKAGE, expected: expectedFor(context, surfaceId), observed, evidence, check });
}

export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

export function lastToolResult(session, toolName) {
  return session
    .ofType('message_end')
    .map((record) => record.message)
    .filter((message) => message?.role === 'toolResult' && message.toolName === toolName)
    .at(-1);
}

export function toolResultText(session, toolName) {
  return messageText(lastToolResult(session, toolName));
}

export function toolResultDetails(session, toolName) {
  return lastToolResult(session, toolName)?.details;
}

export function writeRaw(context, name, value) {
  const path = join(context.rawDir, name);
  mkdirSync(join(context.rawDir), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadPackageModule(context, relative) {
  return import(new URL(`${PACKAGE}/${relative}`, `file://${context.repoRoot}/`).href);
}

export async function waitForValue(probe, { timeoutMs = WAIT_MS, description = 'a value' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await Promise.resolve()
      .then(() => probe())
      .catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function prepareChildAgentDir(context, name, settings = {}) {
  const agentDir = join(context.scratchDir, name);
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  copyFileSync(PROVIDER, join(agentDir, 'extensions', 'pstack-tools-provider.js'));
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ extensions: ['extensions/pstack-tools-provider.js'], ...settings }, null, 2)}\n`);
  return agentDir;
}

export async function startObserved(context, name, options = {}) {
  const observerFile = join(context.rawDir, `observer-${name}.json`);
  const { env = {}, extraExtensions = [], ...rest } = options;
  const session = context.startSession({
    packagePath: options.packagePath ?? packetPath(context),
    extraExtensions: [OBSERVER, PROVIDER, ...extraExtensions],
    env: { PSTACK_TOOLS_OBSERVER_PATH: observerFile, ...env },
    ...rest,
  });
  await session.state();
  await waitForValue(() => (existsSync(observerFile) ? readJson(observerFile) : undefined), { description: `observer snapshot ${observerFile}` });
  await session.send({ type: 'set_model', provider: 'pstack-verify', modelId: 'scripted' });
  return { session, observerFile };
}

async function driveRawSession(context, name, handler) {
  const capture = join(context.rawDir, `${name}.jsonl`);
  mkdirSync(context.rawDir, { recursive: true });
  const child = spawn(
    context.piBin,
    ['--mode', 'rpc', '--no-session', '--no-extensions', '-e', packetPath(context), '-e', PROVIDER, '--no-skills', '--no-prompt-templates', '--no-context-files', '--provider', 'pstack-verify', '--model', 'scripted', '--thinking', 'off'],
    { cwd: context.scratchDir, env: { ...process.env, PI_CODING_AGENT_DIR: context.scratchDir }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const records = [];
  const waiters = [];
  let stderr = '';
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let boundary = buffer.indexOf('\n');
    while (boundary >= 0) {
      const line = buffer.slice(0, boundary).replace(/\r$/, '');
      buffer = buffer.slice(boundary + 1);
      if (line) {
        appendFileSync(capture, `${line}\n`);
        try {
          records.push(JSON.parse(line));
        } catch {
          records.push({ type: 'unparsed', line });
        }
      }
      for (const waiter of [...waiters]) waiter();
      boundary = buffer.indexOf('\n');
    }
  });
  const waitFor = (predicate, description) =>
    waitForValue(
      () => {
        const match = records.find(predicate);
        return match ? { match, records: [...records] } : undefined;
      },
      { description },
    );
  const send = (payload) => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };
  try {
    return await handler({ child, records, waitFor, send, capture, stderr: () => stderr });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      const deadline = Date.now() + 5000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
}

export async function cancelFirstDialog(context, prompt, name) {
  return driveRawSession(context, name, async ({ waitFor, send, capture, records }) => {
    send({ id: 'raw-prompt', type: 'prompt', message: prompt });
    const { match: dialog } = await waitFor((record) => record.type === 'extension_ui_request' && record.method === 'select', 'the first select dialog');
    send({ type: 'extension_ui_response', id: dialog.id, cancelled: true });
    const { match: end } = await waitFor((record) => record.type === 'tool_execution_end' && record.toolName === 'AskQuestion', 'the AskQuestion tool result');
    await waitFor((record) => record.type === 'agent_settled', 'agent_settled');
    return { capture, dialog, result: end, records: [...records] };
  });
}
