// wireBenny with no spawnWorker: the tracker worker is launched by the production default, spawnInTmux(projectRoot, { allowExternalWrite: true }),
// on the real Pi binary. The workers name their model with --model: a Pi that picks its model from settings.json alone landed on no
// model in about a quarter of 8 concurrent starts ("No API key found"), and never did with --model. Only the environment points it at a private tmux server, agent dir, and the scripted model.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { type Automation } from '../../adapters/automation-events.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { outboxEntries } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { FIXTURE, killTmuxServer, makeProject, PI, type Project, stopProject, TMUX, until } from '../worker-lifecycle/harness.ts';
import { bennyProject, fakeGh, fakeSlack, REPORT, ROOT_TS, wiringDeps } from './benny-fakes.ts';

const SERVER = join(PACKAGE_ROOT, 'tests/worker-lifecycle/fixtures/notes-mcp-server.mjs');
const READ = 'mcp__notes__read_note';
const WRITE = 'mcp__notes__write_note';
const DELETE = 'mcp__notes__delete_note';

let project: Project | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (project !== undefined) await stopProject(project);
  project = undefined;
});
afterAll(killTmuxServer);

test('the production default launches the tracker worker on real Pi: the authorized write tool reaches the server and an unauthorized one never does', async () => {
  project = makeProject('pstack-benny-prod-');
  const current = project;
  const calls = join(current.home, 'mcp-calls.jsonl');
  const verdict = 'Reproducible export failure.\n[benny:bug]';
  const caseResult = JSON.stringify({ text: verdict, tracker: { operation: 'create', title: 'Export fails on Safari', body: 'Expected a download.' } });
  const reach = `const out = [];
for (const [name, args] of [['${WRITE}', { key: 'beta', text: 'tracked' }], ['${DELETE}', { key: 'alpha' }]]) {
  try { out.push(name + ' => ' + JSON.stringify(await tools[name](args))); } catch (error) { out.push(name + ' unreachable'); }
}
return out.join('\\n');`;
  const trackerScript = JSON.stringify([{ tool: 'codemode', args: { code: reach } }, { tool: DELETE, args: { key: 'alpha' } }, { text: '{"outcome":"created","id":"LIN-42"}' }]);
  mkdirSync(join(current.agentDir, 'pstack'), { recursive: true });
  writeFileSync(join(current.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'scripted', defaultModel: 'echo', extensions: [FIXTURE] }));
  writeFileSync(join(current.agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { notes: { command: 'node', args: [SERVER], env: { MCP_FIXTURE_LOG: calls } } } }));
  writeFileSync(join(current.agentDir, 'pstack', 'readonly-mcp.json'), JSON.stringify({ tools: [READ] }));
  writeFileSync(join(current.agentDir, 'pstack', 'tracker-mcp.json'), JSON.stringify({ tools: [WRITE] }));
  for (const [name, value] of Object.entries({ HOME: current.home, PI_CODING_AGENT_DIR: current.agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PSTACK_TMUX_SOCKET: TMUX, PATH: `${dirname(PI)}:${process.env['PATH']}`, PSTACK_SCRIPTED_DIRECTIVES: JSON.stringify([{ when: '# Benny tracker action', directive: `@@script ${trackerScript}` }, { when: '# Benny triage case', directive: `@@say ${caseResult}` }]) })) vi.stubEnv(name, value);

  const benny = bennyProject({ root: current.dir, adapterSkill: 'linear-adapter', model: 'scripted/echo' });
  const slack = fakeSlack();
  const gh = fakeGh();
  const automation: Automation = wireBenny(benny.config('triage'), wiringDeps(slack, gh, { env: { PI_CODING_AGENT_DIR: current.agentDir } }));

  const run = await automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  await until(async () => (await completeSettledRuns(automation)) > 0 || automation.pendingRuns().length === 0, Boolean, 120_000, 'the case worker and the tracker worker to settle and the case to complete');

  expect(outboxEntries(automation.store)).toContainEqual(expect.objectContaining({ state: 'done', destinationTs: 'LIN-42' }));
  expect(slack.posts).toEqual([{ thread_ts: ROOT_TS, text: verdict }]);
  const reached = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line).tool);
  expect(reached).toContain('write_note');
  expect(reached).not.toContain('delete_note');
}, 180_000);
