// A stand-in for `pi --mode rpc` that emits chosen RPC orderings real Pi produces only under rare timing.
// Prompts it understands:
//   @@say <text>     run: reply <text>, each record written separately
//   @@chunk <text>   run: the prompt response, the run, and agent_settled in one stdout write
//   @@hold <text>    start a run that replies <text> and stays open until the next prompt arrives
//   @@env <name>     run: reply with the value of environment variable <name>, or (unset)
// A prompt that arrives while a held run is open is acknowledged as queued, then the held run settles. The queued
// prompt stays pending (`@@say`) or starts streaming at once (`@@stream`) until <session-dir>/release exists, then runs.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const sessionDir = process.argv[process.argv.indexOf('--session-dir') + 1];
mkdirSync(sessionDir, { recursive: true });
const sessionFile = join(sessionDir, 'fake.jsonl');
const modelArg = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'scripted/echo';
const model = { provider: modelArg.slice(0, modelArg.indexOf('/')), id: modelArg.slice(modelArg.indexOf('/') + 1) };
let streaming = false;
let held = false;
const pending = [];

const line = (record) => `${JSON.stringify(record)}\n`;
const response = (id, command, data) => line({ type: 'response', id, command, success: true, data });
const run = (text) => {
  appendFileSync(sessionFile, line({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  return line({ type: 'agent_start' }) + line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } });
};
const settled = (aborted = false) => line({ type: 'agent_settled', aborted });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (message) => message.replace(/^@@\w+ /, '');

createInterface({ input: process.stdin }).on('line', async (input) => {
  const command = JSON.parse(input);
  const { id, type } = command;
  if (type === 'get_state') {
    process.stdout.write(response(id, type, { model, sessionFile, isStreaming: streaming, pendingMessageCount: pending.length }));
  } else if (type === 'clear_queue') {
    process.stdout.write(response(id, type, { steering: pending.splice(0), followUp: [] }));
  } else if (type === 'abort') {
    const wasHeld = held;
    held = false;
    streaming = false;
    process.stdout.write(response(id, type) + (wasHeld ? settled(true) : ''));
  } else if (type === 'prompt' && held) {
    pending.push(command.message);
    process.stdout.write(response(id, type, { disposition: 'queued' }));
    await sleep(100);
    held = false;
    // With @@stream the queued prompt has already started the next run when the held one settles.
    const started = command.message.startsWith('@@stream ') ? pending.shift() : undefined;
    streaming = started !== undefined;
    process.stdout.write(settled());
    while (!existsSync(join(sessionDir, 'release'))) await sleep(50);
    process.stdout.write(run(textOf(started ?? pending.shift())));
    streaming = false;
    process.stdout.write(settled());
  } else if (type === 'prompt') {
    const text = command.message.startsWith('@@env ') ? (process.env[textOf(command.message)] ?? '(unset)') : textOf(command.message);
    if (command.message.startsWith('@@chunk ')) {
      process.stdout.write(response(id, type, { disposition: 'started' }) + run(text) + settled());
    } else if (command.message.startsWith('@@hold ')) {
      streaming = true;
      held = true;
      process.stdout.write(response(id, type, { disposition: 'started' }));
      process.stdout.write(run(text));
    } else {
      streaming = true;
      process.stdout.write(response(id, type, { disposition: 'started' }));
      await sleep(20);
      process.stdout.write(run(text));
      streaming = false;
      await sleep(20);
      process.stdout.write(settled());
    }
  }
});
process.stdin.on('end', () => process.exit(0));
