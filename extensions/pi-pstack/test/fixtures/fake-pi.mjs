// Stands in for `pi --mode rpc` in runner tests: JSONL commands on stdin, responses and events on stdout. Behavior comes from FAKE_PI_MODE.
import { spawn } from 'node:child_process';

const mode = process.env.FAKE_PI_MODE ?? 'echo';
const usage = { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } };
const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const assistant = (text, extra = {}) => emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], usage, stopReason: 'stop', ...extra } });
const respond = (command, data) => emit({ id: command.id, type: 'response', command: command.type, success: true, ...(data === undefined ? {} : { data }) });

let running = false;
// Set while a run waits for a steer or a dialog answer.
let finish;

function settle(aborted = false) {
  running = false;
  finish = undefined;
  emit({ type: 'agent_settled', aborted });
}

function run(message, images) {
  running = true;
  emit({ type: 'agent_start' });
  if (mode === 'split-utf8') {
    const record = Buffer.from(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '你好 🥔 café\u2028fin' }], usage, stopReason: 'stop' } })}\n`);
    const split = record.indexOf(Buffer.from('🥔')) + 1;
    finish = () => {
      process.stdout.write(record.subarray(split));
    };
    process.stdout.write(Buffer.concat([Buffer.from(`${JSON.stringify({ type: 'fake_split_ready' })}\n`), record.subarray(0, split)]));
    return;
  } else if (mode === 'noise') {
    process.stdout.write('an extension printed this to stdout\n');
    assistant('after noise');
  } else if (mode === 'echo') {
    assistant('thinking out loud');
    const shown = images.length === 0 ? '' : `|IMAGES:${images.map((image) => image.mimeType).join(',')}`;
    assistant(`GOT:${message}${shown}|ARGS:${process.argv.slice(2).join(' ')}`);
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
    emit({ type: 'fake_pids', pids: [process.pid, sleeper.pid] });
    return;
  } else if (mode === 'wait' || mode === 'deaf') {
    finish = (text) => {
      assistant(text);
      settle();
    };
    return;
  } else if (mode === 'dialog') {
    emit({ type: 'extension_ui_request', id: 'note-1', method: 'notify', message: 'fire and forget' });
    emit({ type: 'extension_ui_request', id: 'dialog-1', method: 'select', title: 'Pick one', options: ['a', 'b'] });
    finish = (text) => {
      assistant(text);
      settle();
    };
    return;
  }
  settle();
}

function handle(command) {
  if (command.type === 'prompt') {
    if (!running) {
      respond(command, { disposition: 'started' });
      run(command.message, command.images ?? []);
    } else {
      if (mode === 'split-utf8') finish?.();
      respond(command, { disposition: 'queued' });
      if (mode === 'split-utf8') settle();
      if (mode === 'wait' || mode === 'deaf') finish?.(`STEERED:${command.message}|${command.streamingBehavior}`);
    }
  } else if (command.type === 'extension_ui_response') {
    if (mode === 'dialog') finish?.(`ANSWER:${JSON.stringify(command)}`);
  } else if (command.type === 'abort') {
    if (mode === 'deaf') return;
    if (running) {
      assistant('', { stopReason: 'aborted' });
      settle(true);
    }
    respond(command);
  } else if (command.type === 'clear_queue') {
    respond(command, { steering: [], followUp: [] });
  }
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim() !== '') handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => {
  if (mode !== 'hang') process.exit(0);
});
