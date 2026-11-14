#!/usr/bin/env node
// A stand-in for the pi binary that fails the ways a real one can. FAKE_PI_MODE: crash | silent | no-session | sandbox-removed | busy | stalled | dump-env (writes its environment to FAKE_PI_ENV_OUT, then exits).
// FAKE_PI_SESSION: a session file the busy mode copies in when it goes idle, in place of a bare header.
// busy: streams an event every 100 ms for FAKE_PI_BUSY_MS, then goes idle and writes its session. stalled: streams once, then never finishes and never writes again.
import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_PI_MODE;
const sandbox = dirname(process.cwd());
let streaming = false;
let stateReads = 0;
if (mode === 'crash') {
  console.error('fatal: provider auth missing');
  process.exit(3);
}
if (mode === 'dump-env') {
  writeFileSync(process.env.FAKE_PI_ENV_OUT, JSON.stringify(process.env));
  process.exit(3);
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (mode === 'silent') return;
  const answer = (data) => console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data }));
  if (mode === 'interrupt') {
    const target = `${sandbox}/sessions/never-written.jsonl`;
    if (command.type === 'prompt') {
      streaming = true;
      writeFileSync(target, `${JSON.stringify({ type: 'session', id: 'x', cwd: process.cwd() })}\n`);
      answer({});
      console.log(JSON.stringify({ type: 'tool_execution_start', toolName: 'pstack_worker', args: { action: 'spawn' } }));
      return;
    }
    if (command.type === 'steer') {
      writeFileSync(`${sandbox}/interrupt.json`, JSON.stringify({ message: command.message, streaming }));
      streaming = false;
      return answer({});
    }
    if (command.type === 'get_state') {
      streaming = false;
      return answer({ sessionFile: target, isStreaming: false, pendingMessageCount: 0 });
    }
  }
  if (command.type === 'prompt' && (mode === 'busy' || mode === 'stalled')) {
    answer({});
    streaming = true;
    const until = Date.now() + Number(process.env.FAKE_PI_BUSY_MS ?? 0);
    console.log(JSON.stringify({ type: 'agent_start' }));
    if (mode === 'busy') {
      const timer = setInterval(() => {
        console.log(JSON.stringify({ type: 'message_update', at: Date.now() }));
        if (Date.now() < until) return;
        clearInterval(timer);
        const target = `${sandbox}/sessions/never-written.jsonl`;
        if (process.env.FAKE_PI_SESSION) copyFileSync(process.env.FAKE_PI_SESSION, target);
        else writeFileSync(target, `${JSON.stringify({ type: 'session', id: 'x', cwd: process.cwd() })}\n`);
        streaming = false;
      }, 100);
    }
    return;
  }
  if (command.type === 'get_state') {
    if (mode === 'nested-worker') {
      stateReads += 1;
      writeFileSync(`${sandbox}/sessions/never-written.jsonl`, `${JSON.stringify({ type: 'session', id: 'x', cwd: process.cwd() })}\n`);
      if (stateReads >= 3) writeFileSync(process.env.FAKE_PI_NESTED_STATE, JSON.stringify({ phase: 'idle' }));
    }
    if (mode === 'sandbox-removed') rmSync(sandbox, { recursive: true, force: true });
    return answer({ sessionFile: `${sandbox}/sessions/never-written.jsonl`, isStreaming: streaming, pendingMessageCount: 0 });
  }
  answer({});
});
