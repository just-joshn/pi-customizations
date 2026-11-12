// A readonly worker reaches MCP only through the tools the operator authorized as read-only, on the real Pi binary with a real
// stdio MCP server. Pi's own filtering decides: the --tools list names the authorized tools, so codemode and tool_search reach nothing else.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { spawnAssignment } from '../../src/workers.ts';
import { killTmuxServer, makeParent, makeProject, makeRun, PI, type Parent, type Project, stopProject, TEST_PI_ARGS, TMUX, until, workerTestEnv, writeAssignment } from './harness.ts';

const WORKER_SIDE = join(PACKAGE_ROOT, 'tests/worker-lifecycle/worker-side-extension.ts');
const SERVER = join(PACKAGE_ROOT, 'tests/worker-lifecycle/fixtures/notes-mcp-server.mjs');
const READ = 'mcp__notes__read_note';
const WRITE = 'mcp__notes__write_note';
const PI_ARGS = [...TEST_PI_ARGS.filter((arg) => arg !== '--no-mcp' && arg !== '--no-extensions'), '--extension', WORKER_SIDE];

const REACH = `const out = [];
for (const [name, args] of [['${READ}', { key: 'alpha' }], ['${WRITE}', { key: 'alpha', text: 'OVERWRITTEN' }]]) {
  try { out.push(name + ' => ' + JSON.stringify(await tools[name](args))); } catch (error) { out.push(name + ' unreachable: ' + error.message.slice(0, 60)); }
}
return out.join('\\n');`;
const SCRIPT = [{ tool: 'codemode', args: { code: REACH } }, { tool: WRITE, args: { key: 'alpha', text: 'OVERWRITTEN' } }, { tool: 'tool_search', args: { query: 'write note' } }, { tool: 'tool_search', args: { query: 'read note' } }, { tool: READ, args: { key: 'alpha' } }];
const BRIEF = `@@script ${JSON.stringify(SCRIPT)}`;

let project: Project;
let parent: Parent;
let calls: string;

const serverCalls = (): string[] => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).tool) : []);

beforeEach(async () => {
  project = makeProject();
  makeRun(project, 'run1');
  calls = join(project.home, 'mcp-calls.jsonl');
  writeFileSync(join(project.agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { notes: { command: 'node', args: [SERVER], env: { MCP_FIXTURE_LOG: calls } } } }));
  parent = makeParent(project, [], { extraPiArgs: PI_ARGS });
  await parent.start();
});

afterEach(async () => {
  await parent.stop();
  await stopProject(project);
});

afterAll(killTmuxServer);

const authorize = (...tools: string[]) => {
  mkdirSync(join(project.agentDir, 'pstack'), { recursive: true });
  writeFileSync(join(project.agentDir, 'pstack', 'readonly-mcp.json'), JSON.stringify({ tools }));
};

const finalText = (workerId: string) =>
  until(
    async () => (await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId })).details,
    (result) => result.settled === true,
    60_000,
    `${workerId} settles`,
  ).then((result) => result.finalText as string);

const results = (text: string) => text.split('\n[');

test('a readonly worker with an authorized read tool reads through codemode and directly, and cannot write by codemode, directly, or after tool_search', async () => {
  authorize(READ);
  await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'ro', BRIEF, { capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false } }) });
  const text = await finalText('ro');
  expect(text).toContain(`${READ} => {"content":[{"type":"text","text":"the stored note"}]}`);
  expect(text).toContain(`${WRITE} unreachable`);
  expect(text).toMatch(/\[tool_search\] No matching tools|\[tool_search\] Loaded 1 tool/);
  expect(text).not.toContain(`- ${WRITE}`);
  expect(results(text).some((entry) => entry.startsWith(`${WRITE} error`) || /Tool mcp__notes__write_note not found/.test(entry))).toBe(true);
  expect(serverCalls().filter((tool) => tool === 'write_note')).toEqual([]);
  expect(serverCalls()).toContain('read_note');
});

test('with nothing authorized a readonly worker reaches no MCP tool at all', async () => {
  await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: writeAssignment(project, 'run1', 'ro', BRIEF, { capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false } }) });
  const text = await finalText('ro');
  expect(text).toContain(`${READ} unreachable`);
  expect(text).toContain(`${WRITE} unreachable`);
  expect(serverCalls()).toEqual([]);
});

test('a trusted spawner that grants externalWrite gives a readonly worker the whole MCP route', async () => {
  const path = writeAssignment(project, 'run1', 'trusted', BRIEF, { capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: true } });
  await spawnAssignment(project.dir, 'run1' as never, path, { tmuxSocket: TMUX, piCommand: [PI], extraPiArgs: PI_ARGS, extraEnv: workerTestEnv(project), agentsDir: project.agentsDir, allowExternalWrite: true });
  const text = await finalText('trusted');
  expect(text).toContain(`${WRITE} => {"content":[{"type":"text","text":"stored alpha"}]}`);
  expect(serverCalls()).toContain('write_note');
});
