// A stand-in for `pi --mode rpc`: strict LF-framed JSONL on stdin/stdout.
// The prompt text selects the turn behavior, FAKE_PI_* env selects process behavior.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const logFile = process.env.FAKE_PI_LOG;
const stubborn = process.env.FAKE_PI_STUBBORN;
const sessionFlag = process.argv.indexOf('--session');
const sessionFile = sessionFlag >= 0 ? process.argv[sessionFlag + 1] : (process.env.FAKE_PI_SESSION_FILE ?? join(process.cwd(), 'session.jsonl'));
let lastText;

const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const reply = (command, data) => emit({ type: 'response', id: command.id, command: command.type, success: true, data });
const fail = (command, error) => emit({ type: 'response', id: command.id, command: command.type, success: false, ...(error ? { error } : {}) });
const assistant = (fields) => emit({ type: 'message_end', message: { role: 'assistant', content: [], ...fields } });

function settle() {
  emit({ type: 'agent_settled' });
}

function finishTurn(text) {
  emit({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'ignored' }] } });
  emit({ type: 'tool_execution_end', toolName: 'read' });
  emit({ type: 'tool_execution_end', toolName: 'grep' });
  lastText = text;
  assistant({
    content: [
      { type: 'thinking', text: 'hidden' },
      { type: 'text', text },
    ],
  });
  settle();
}

function runTurn(message) {
  if (message === 'hang') return;
  if (message === 'die') {
    process.stderr.write('crashed hard', () => process.exit(3));
    return;
  }
  if (message === 'fail') {
    assistant({ stopReason: 'error', errorMessage: 'model exploded' });
    settle();
    return;
  }
  if (message === 'abort') {
    assistant({ stopReason: 'aborted' });
    settle();
    return;
  }
  if (message.startsWith('ask:')) {
    emit({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: message.slice(4), message: 'run it' });
    return;
  }
  finishTurn(`done: ${message}`);
}

function handle(command) {
  record(command);
  switch (command.type) {
    case 'get_state':
      if (process.env.FAKE_PI_STATE === 'error') return fail(command, 'no session store');
      reply(command, process.env.FAKE_PI_STATE === 'none' ? {} : { sessionId: 'sess-fake', sessionFile });
      if (process.env.FAKE_PI_STATE === 'exit') process.stdout.write('', () => process.exit(5));
      return undefined;
    case 'prompt':
      reply(command, {});
      return setImmediate(() => runTurn(command.message));
    case 'get_last_assistant_text':
      return reply(command, lastText === undefined ? {} : { text: lastText });
    case 'get_session_stats':
      if (process.env.FAKE_PI_STATS === 'off') return fail(command, 'stats unavailable');
      return reply(command, { tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }, cost: 0.5 });
    case 'extension_ui_response':
      return finishTurn(`answer: confirmed=${command.confirmed} cancelled=${command.cancelled}`);
    case 'fail_me':
      return fail(command, 'nope');
    case 'fail_silent':
      return fail(command);
    case 'ignore':
      return undefined;
    case 'exit':
      process.stderr.write('bye', () => process.exit(4));
      return undefined;
    case 'emit':
      reply(command, { n: command.n });
      return emit({ type: 'custom_event', n: command.n });
    case 'noise':
      return noise(command);
    default:
      return reply(command, { echoed: command.type, message: command.message });
  }
}

function noise(command) {
  reply(command, {});
  process.stdout.write('not json at all\n\n[1]\n{"type":5}\n{"id":"x"}\n');
  emit({ type: 'response', id: 'unknown-id', success: true });
  process.stdout.write('{"type":"split"');
  setImmediate(() => process.stdout.write(',"n":1}\r\n'));
}

const record = (entry) => {
  if (logFile) appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
};
record({ type: 'started', args: process.argv.slice(2) });

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => handle(JSON.parse(line)));
lines.on('close', () => {
  record({ type: 'stdin_closed' });
  if (!stubborn) process.exit(0);
});
if (stubborn) {
  if (stubborn === 'kill') process.on('SIGTERM', () => undefined);
  setTimeout(() => process.exit(9), 30000);
}
