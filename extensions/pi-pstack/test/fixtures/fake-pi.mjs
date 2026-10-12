// Stands in for `pi --mode json` in runner tests. Behavior comes from FAKE_PI_MODE.
import { spawn } from 'node:child_process';

const mode = process.env.FAKE_PI_MODE ?? 'echo';
const usage = { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } };
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const assistant = (text, extra = {}) => emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], usage, stopReason: 'stop', ...extra } });

let stdin = '';
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  emit({ type: 'session', version: 3, id: 'fake-session' });
  if (mode === 'noise') {
    process.stdout.write('an extension printed this to stdout\n');
    assistant('after noise');
  } else if (mode === 'echo') {
    assistant('thinking out loud');
    assistant(`GOT:${stdin}|ARGS:${process.argv.slice(2).join(' ')}`);
  } else if (mode === 'nested') {
    assistant('calling a tool');
    emit({ type: 'message_end', message: { role: 'toolResult', toolName: 'Task', content: [{ type: 'text', text: 'grandchild' }], usage } });
    emit({ type: 'compaction_end', reason: 'threshold', result: { summary: 's', usage }, aborted: false, willRetry: false });
    assistant('done');
  } else if (mode === 'error') {
    assistant('', { stopReason: 'error', errorMessage: 'provider exploded' });
  } else if (mode === 'crash') {
    process.stderr.write('fatal: no model\n');
    process.exit(3);
  } else if (mode === 'hang') {
    const sleeper = spawn('sleep', ['60'], { stdio: 'ignore' });
    process.stdout.write(`${JSON.stringify({ type: 'fake_pids', pids: [process.pid, sleeper.pid] })}\n`);
    setInterval(() => {}, 1000);
  }
});
