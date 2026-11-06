// Positive and negative readonly probes against the installed tarball, not checkout imports.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';

const [root, evidence] = process.argv.slice(2);
const work = join(root, 'work');
const pi = join(work, 'node_modules/.bin/pi');
const env = { HOME: join(root, 'home'), PATH: `${join(work, 'node_modules/.bin')}:${process.env.PATH}`, LANG: 'C.UTF-8', CI: '1', PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' };
const text = (content) => typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text).join('');
const script = (steps) => `run the script\n@@script ${JSON.stringify(steps)}`;
writeFileSync(join(work, 'readonly-input.txt'), 'RO-POSITIVE-READ\n');
let reached = false;
const server = createServer((_request, response) => { reached = true; response.end('READONLY_LOCAL_NET'); });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const { port } = server.address();
  const steps = [
    { tool: 'bash', args: { command: 'cat readonly-input.txt' } },
    { tool: 'bash', args: { command: `node -e 'fetch("http://127.0.0.1:${port}/").then(r=>r.text()).then(t=>process.stdout.write(t))'` } },
    { tool: 'bash', args: { command: 'touch readonly-must-not-exist.txt' } },
  ];
  const args = ['--mode', 'json', '--offline', '--no-session', '--no-mcp', '--no-approve', '--model', 'scripted/echo', script([{ tool: 'Task', args: { description: 'packaged readonly shell probes', readonly: true, run_in_background: false, prompt: script(steps) } }])];
  console.log(`Command: ${pi} ${args.join(' ')}`);
  const run = promisify(execFile)(pi, args, { cwd: work, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  run.child.stdin.end(); // One-shot JSON mode consumes stdin before starting the positional prompt.
  const { stdout, stderr } = await run;
  writeFileSync(join(evidence, 'consumer-readonly.stdout.jsonl'), stdout);
  writeFileSync(join(evidence, 'consumer-readonly.stderr.log'), stderr);
  const events = stdout.trim().split('\n').map((line) => JSON.parse(line));
  const task = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'Task');
  assert.equal(task.isError, false);
  const response = text(task.result.content);
  const blocked = response.includes('no verified OS sandbox is available') && response.includes('bubblewrap');
  const readPassed = response.includes('[bash] RO-POSITIVE-READ');
  const networkPassed = reached && response.includes('[bash] READONLY_LOCAL_NET');
  const writeRefused = response.includes('[bash error]') && !existsSync(join(work, 'readonly-must-not-exist.txt'));
  const result = {
    status: blocked ? 'BLOCKED' : readPassed && networkPassed && writeRefused ? 'PASS' : 'ISSUES',
    positiveRead: readPassed ? 'PASS' : blocked ? 'BLOCKED' : 'ISSUES',
    positiveLocalNetworkRead: networkPassed ? 'PASS' : blocked ? 'BLOCKED' : 'ISSUES',
    writeAttemptRefused: writeRefused,
    localHttpServerReached: reached,
    noUnsandboxedFallbackObserved: blocked && !readPassed && !networkPassed && writeRefused,
    response,
  };
  writeFileSync(join(evidence, 'consumer-readonly-checks.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  assert.equal(readPassed, true, `${result.status}: positive readonly file read must execute`);
  assert.equal(networkPassed, true, `${result.status}: positive readonly network read must execute`);
  assert.equal(writeRefused, true, 'readonly writes must be refused');
} finally {
  server.close();
  await once(server, 'close');
}
