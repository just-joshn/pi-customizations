// A stand-in for `pi --mode rpc` that emits chosen RPC orderings real Pi produces only under rare timing.
// Prompts it understands:
//   @@say <text>     run: reply <text>, each record written separately
//   @@chunk <text>   run: the prompt response, the run, and agent_settled in one stdout write
//   @@hold <text>    start a run that replies <text> and stays open until the next prompt arrives
//   @@env <name>     run: reply with the value of environment variable <name>, or (unset)
//   @@settle-busy <text>  run: reply <text>, emit agent_settled while still streaming, then compaction_end once quiescent
//   @@hold-late <text>    like @@hold, but abort emits agent_settled while still streaming and answers once quiescent
//   @@env-json <names...>  run: reply with a JSON object of each named variable's value, null when unset
//   @@overlap <forward|reverse> <recheck|runs> <text>  run: reply <text> and settle, then either emit compaction_end
//                         (recheck) or run and settle again (runs); hold the first of the two get_state requests that
//                         follow and answer both together in the given order
//   @@stale <text>        run: reply <text> and settle; answer the next get_state only after the next prompt's
//                         acknowledgement, with the state from when it arrived
//   @@wait <text>         start a run that replies <text> once <session-dir>/release exists
//   @@late-ack <text>     run: reply <text> and settle before acknowledging the prompt, which is acknowledged right
//                         after the next get_state answer
//   @@error-window <text> run: stop with error <text>, then answer the next get_state that arrives within 300 ms as
//                         quiescent before emitting agent_settled, as Pi does while its agent_settled handlers run
// The run directives that acknowledge first wait briefly before running, so a get_state the host sends on the
// acknowledgement is answered while the run is still streaming.
// A prompt that arrives while a held run is open is acknowledged as queued, then the held run settles. The queued
// prompt stays pending (`@@say`) or starts streaming at once (`@@stream`) until <session-dir>/release exists, then runs.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const sessionDir = process.argv[process.argv.indexOf('--session-dir') + 1];
mkdirSync(sessionDir, { recursive: true });
const sessionFile = join(sessionDir, 'fake.jsonl');
const modelArg = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'scripted/echo';
const model = { provider: modelArg.slice(0, modelArg.indexOf('/')), id: modelArg.slice(modelArg.indexOf('/') + 1) };
let streaming = false;
let held = false;
let late = false;
let overlap;
let deferred;
let holdState = false;
let heldState;
let afterState;
const pending = [];

const line = (record) => `${JSON.stringify(record)}\n`;
const response = (id, command, data) => line({ type: 'response', id, command, success: true, data });
const run = (text) => {
  appendFileSync(sessionFile, line({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  return line({ type: 'agent_start' }) + line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } });
};
const settled = (aborted = false) => line({ type: 'agent_settled', aborted });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (message) => message.replace(/^@@[\w-]+ /, '');
const compactionEnd = () => line({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false });
const acknowledge = (id, disposition) => {
  const answer = heldState ?? '';
  heldState = undefined;
  return response(id, 'prompt', { disposition }) + answer;
};
const release = async () => {
  while (!existsSync(join(sessionDir, 'release'))) await sleep(50);
};

createInterface({ input: process.stdin }).on('line', async (input) => {
  const command = JSON.parse(input);
  const { id, type } = command;
  const state = (stateId) => response(stateId, 'get_state', { model, sessionFile, isStreaming: streaming, pendingMessageCount: pending.length });
  if (type === 'get_state' && overlap !== undefined && deferred === undefined) {
    deferred = state(id);
  } else if (type === 'get_state' && overlap !== undefined) {
    process.stdout.write(overlap === 'reverse' ? state(id) + deferred : deferred + state(id));
    overlap = undefined;
    deferred = undefined;
  } else if (type === 'get_state' && holdState) {
    holdState = false;
    heldState = state(id);
    writeFileSync(join(sessionDir, 'held'), '');
  } else if (type === 'get_state') {
    process.stdout.write(state(id) + (afterState ?? ''));
    afterState = undefined;
  } else if (type === 'clear_queue') {
    process.stdout.write(response(id, type, { steering: pending.splice(0), followUp: [] }));
  } else if (type === 'abort' && late) {
    late = false;
    process.stdout.write(settled(true));
    await sleep(100);
    held = false;
    streaming = false;
    process.stdout.write(response(id, type));
  } else if (type === 'abort') {
    const wasHeld = held;
    held = false;
    streaming = false;
    process.stdout.write(response(id, type) + (wasHeld ? settled(true) : ''));
  } else if (type === 'prompt' && held) {
    pending.push(command.message);
    process.stdout.write(acknowledge(id, 'queued'));
    await sleep(100);
    held = false;
    // With @@stream the queued prompt has already started the next run when the held one settles.
    const started = command.message.startsWith('@@stream ') ? pending.shift() : undefined;
    streaming = started !== undefined;
    process.stdout.write(settled());
    await release();
    process.stdout.write(run(textOf(started ?? pending.shift())));
    streaming = false;
    process.stdout.write(settled());
  } else if (type === 'prompt') {
    const text = command.message.startsWith('@@env ')
      ? (process.env[textOf(command.message)] ?? '(unset)')
      : command.message.startsWith('@@env-json ')
        ? JSON.stringify(
            Object.fromEntries(
              textOf(command.message)
                .split(' ')
                .map((name) => [name, process.env[name] ?? null]),
            ),
          )
        : textOf(command.message);
    if (command.message.startsWith('@@chunk ')) {
      process.stdout.write(acknowledge(id, 'started') + run(text) + settled());
    } else if (command.message.startsWith('@@settle-busy ')) {
      streaming = true;
      process.stdout.write(acknowledge(id, 'started') + run(text) + settled());
      await sleep(300);
      streaming = false;
      process.stdout.write(compactionEnd());
    } else if (command.message.startsWith('@@overlap ')) {
      const [order, kind, ...words] = textOf(command.message).split(' ');
      streaming = true;
      process.stdout.write(acknowledge(id, 'started'));
      await sleep(50);
      streaming = false;
      overlap = order;
      process.stdout.write(run(words.join(' ')) + settled() + (kind === 'runs' ? run(words.join(' ')) + settled() : compactionEnd()));
    } else if (command.message.startsWith('@@stale ')) {
      streaming = true;
      process.stdout.write(acknowledge(id, 'started'));
      await sleep(50);
      streaming = false;
      holdState = true;
      process.stdout.write(run(text) + settled());
    } else if (command.message.startsWith('@@wait ')) {
      streaming = true;
      process.stdout.write(acknowledge(id, 'started'));
      await release();
      process.stdout.write(run(text));
      streaming = false;
      process.stdout.write(settled());
    } else if (command.message.startsWith('@@late-ack ')) {
      afterState = response(id, type, { disposition: 'started' });
      process.stdout.write(run(text) + settled());
    } else if (command.message.startsWith('@@error-window ')) {
      streaming = true;
      const failure = { role: 'assistant', content: [], stopReason: 'error', errorMessage: text };
      process.stdout.write(acknowledge(id, 'started') + line({ type: 'agent_start' }) + line({ type: 'message_end', message: failure }));
      streaming = false;
      afterState = settled();
      await sleep(300);
      process.stdout.write(afterState ?? '');
      afterState = undefined;
    } else if (command.message.startsWith('@@hold-late ')) {
      streaming = true;
      held = true;
      late = true;
      process.stdout.write(acknowledge(id, 'started'));
      process.stdout.write(run(text));
    } else if (command.message.startsWith('@@hold ')) {
      streaming = true;
      held = true;
      process.stdout.write(acknowledge(id, 'started'));
      process.stdout.write(run(text));
    } else {
      streaming = true;
      process.stdout.write(acknowledge(id, 'started'));
      await sleep(20);
      process.stdout.write(run(text));
      streaming = false;
      await sleep(20);
      process.stdout.write(settled());
    }
  }
});
process.stdin.on('end', () => process.exit(0));
