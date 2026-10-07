import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = 'extensions/pi-pstack';
export const PROVIDER = fileURLToPath(new URL('./pstack-hooks-provider.js', import.meta.url));
export const NAVIGATOR = fileURLToPath(new URL('./pstack-hooks-navigator.js', import.meta.url));
export const SELECTOR = fileURLToPath(new URL('./pstack-hooks-selector.js', import.meta.url));
export const PACKAGE_PATH = (context) => join(context.repoRoot, PACKAGE);

let surfaceCache;
function surfaces(context) {
  if (!surfaceCache) {
    const lines = readFileSync(join(context.repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8').replace(/\n$/, '').split('\n');
    const columns = lines.shift().split('\t');
    surfaceCache = lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, line.split('\t')[index]])));
  }
  return surfaceCache;
}

export function surfaceRow(context, surfaceId) {
  const row = surfaces(context).find((candidate) => candidate.surface_id === surfaceId);
  if (!row) throw new Error(`surfaces.tsv has no row ${surfaceId}`);
  return row;
}

export function expectedFor(context, surfaceId) {
  return surfaceRow(context, surfaceId).expected;
}

export function assertSurface(context, { surfaceId, observed, evidence, check }) {
  return context.receipts.assertVerdict({ surfaceId, package: PACKAGE, expected: expectedFor(context, surfaceId), observed, evidence, check });
}

export function writeSurface(context, { surfaceId, observed, evidence, verdict, reason }) {
  return context.receipts.write({ surfaceId, package: PACKAGE, expected: expectedFor(context, surfaceId), observed, evidence, verdict, scope: 'behaviour', reason });
}

export function prepareHooksAgentDir(context, name, settings = {}) {
  const agentDir = join(context.scratchDir, name);
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  copyFileSync(PROVIDER, join(agentDir, 'extensions', 'pstack-hooks-provider.js'));
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ extensions: ['extensions/pstack-hooks-provider.js'], ...settings }, null, 2)}\n`);
  return agentDir;
}

export async function startHooks(context, name, options = {}) {
  const { env = {}, extraExtensions = [], provider = 'pstack-hooks', modelId = 'scripted', ...rest } = options;
  const capture = join(context.rawDir, `provider-${name}.jsonl`);
  mkdirSync(context.rawDir, { recursive: true });
  writeFileSync(capture, '');
  const session = context.startSession({
    packagePath: PACKAGE_PATH(context),
    extraExtensions: [PROVIDER, ...extraExtensions],
    env: { PSTACK_HOOKS_CAPTURE: capture, ...env },
    ...rest,
  });
  try {
    await session.send({ type: 'set_model', provider, modelId });
  } catch (error) {
    await session.close();
    throw error;
  }
  return { session, capture };
}

export function readCaptures(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

export function capturesFrom(path, since = 0) {
  return readCaptures(path).slice(since);
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

export function toolText(session, toolName) {
  return messageText(lastToolResult(session, toolName));
}

export function notifications(session, method = 'notify') {
  return session.uiRequests.filter((record) => record.method === method);
}

export function statuses(session, statusKey) {
  return session.uiRequests.filter((record) => record.method === 'setStatus' && record.statusKey === statusKey);
}

export function widgets(session, widgetKey) {
  return session.uiRequests.filter((record) => record.method === 'setWidget' && record.widgetKey === widgetKey);
}

export async function waitFor(predicate, { timeoutMs = 30000, description = 'a value' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await Promise.resolve()
      .then(() => predicate())
      .catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function waitForRecord(session, startIndex, predicate, description) {
  return waitFor(() => session.records.slice(startIndex).find(predicate), { description });
}

export async function promptThenAbortAtTool(session, message, toolName) {
  const start = session.records.length;
  await session.send({ type: 'prompt', message });
  await waitForRecord(session, start, (record) => record.type === 'tool_execution_end' && record.toolName === toolName, `tool_execution_end for ${toolName}`);
  await session.send({ type: 'abort' });
  await session.waitForIdle();
}

export function customMessages(session, customType) {
  return session
    .ofType('message_end')
    .map((record) => record.message)
    .filter((message) => message?.role === 'custom' && message.customType === customType);
}

export function customEntries(session, customType) {
  return session.entries.filter((entry) => entry.customType === customType);
}
