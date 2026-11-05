// Pass B: one multi-step workflow through the installed pi binary over RPC, checked against the Cursor-derived oracles.
// A deterministic scripted model drives the tool calls; no LLM and no Cursor process runs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
const pkg = join(repo, 'extensions/pi-pstack');
const fixture = JSON.parse(readFileSync(join(pkg, 'test/fixtures/cursor-agent-definitions.json'), 'utf8'));
const forPi = (text) => text.replace(' Do not create Cursor Canvas files unless requested by the user or by your instructions.', '');
const RUNNING = 'Sub-agent is currently running. You may send the follow-up message when it has completed.';

const sandbox = mkdtempSync(join(tmpdir(), 'pstack-confirm-'));
const agentDir = join(sandbox, 'agent');
const workDir = join(sandbox, 'work');
mkdirSync(agentDir);
mkdirSync(workDir);
writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: [pkg], extensions: [join(pkg, 'test/fixtures/scripted-model.ts')], quietStartup: true }));
const child = spawn('pi', ['--mode', 'rpc', '--offline', '--no-session', '--model', 'scripted/echo'], {
  cwd: workDir,
  env: { ...process.env, HOME: sandbox, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const events = [];
const waiters = [];
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
    const event = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    events.push(event);
    for (const waiter of waiters.filter((candidate) => candidate.predicate(event))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
  }
});
const waitFor = (predicate, timeoutMs = 60_000) =>
  new Promise((resolveWait, rejectWait) => {
    const seen = events.find(predicate);
    if (seen !== undefined) return resolveWait(seen);
    const timer = setTimeout(() => rejectWait(new Error('timed out')), timeoutMs);
    waiters.push({
      predicate,
      resolve: (event) => {
        clearTimeout(timer);
        resolveWait(event);
      },
    });
  });
const text = (content) => (typeof content === 'string' ? content : content.map((part) => part.text ?? '').join(''));
async function turn(steps) {
  const mark = events.length;
  child.stdin.write(`${JSON.stringify({ type: 'prompt', message: `go\n@@script ${JSON.stringify(steps)}` })}\n`);
  await waitFor((event) => event.type === 'agent_settled' && events.indexOf(event) >= mark);
  return events
    .slice(mark)
    .filter((event) => event.type === 'tool_execution_end')
    .map((event) => ({ tool: event.toolName, isError: event.isError, text: text(event.result.content), details: event.result.details }));
}
const task = (args) => ({ tool: 'Task', args: { description: 'confirm', ...args } });
const response = (value) => /<response>\n([\s\S]*?)\n<\/response>/.exec(value)?.[1];

try {
  const first = await turn([
    [
      task({ subagent_type: 'poteto-agent', run_in_background: true, prompt: 'work\n@@sleep 2500 POTETO-DONE' }),
      task({ subagent_type: 'Shell_Agent', prompt: 'list\n@@tools-list' }),
      task({ subagent_type: 'comment-sicko', prompt: 'show\n@@sys' }),
    ],
  ]);
  const [launch, shell, sicko] = first;
  const agentId = launch.details.agentId;
  const second = await turn([task({ resume: agentId, prompt: 'more\n@@say NEVER' })]);
  const notice = await waitFor((event) => event.type === 'message_end' && event.message.role === 'custom' && event.message.customType === 'pstack/task');
  const sickoReminder = forPi(fixture.agents.find((agent) => agent.type === 'comment-sicko').reminder);
  const checks = {
    'background launch uses the transcript wording and the plain Agent ID line':
      launch.text.startsWith('Subagent is running in the background. If needed, you can monitor its output by tailing the transcript at: ') &&
      launch.text.includes(`\n\nAgent ID: ${agentId} (can be used with the \`resume\` parameter to send a follow-up after it completes)`),
    'a follow-up to the running agent fails with the Cursor text': second[0].isError === true && second[0].text === RUNNING,
    'a spelled-out shell type resolves and has only the shell tools': shell.details.subagentType === 'shell' && response(shell.text) === 'bash,bash_background',
    'comment-sicko reads the Cursor system reminder': sicko.text.includes(`<pstack_subagent>\n${sickoReminder}\n</pstack_subagent>`),
    'the completion notification carries the background reply': text(notice.message.content).includes(`task_id: ${agentId}\n`) && text(notice.message.content).includes('\ndetail: POTETO-DONE\n'),
  };
  writeFileSync(join(root, 'evidence/confirm-workflow.json'), `${JSON.stringify({ pi: 'installed pi on PATH', agentId, checks }, null, 2)}\n`);
  console.log(JSON.stringify(checks, null, 2));
  for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
} finally {
  child.stdin.end();
  await new Promise((resolveExit) => child.once('close', resolveExit));
  rmSync(sandbox, { recursive: true, force: true });
}
