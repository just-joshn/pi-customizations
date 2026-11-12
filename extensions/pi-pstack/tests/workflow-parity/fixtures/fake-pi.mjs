#!/usr/bin/env node
// A stand-in for the pi binary that fails the ways a real one can. FAKE_PI_MODE: crash | silent | no-session | sandbox-removed.
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_PI_MODE;
const sandbox = dirname(process.cwd());
if (mode === 'crash') {
  console.error('fatal: provider auth missing');
  process.exit(3);
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (mode === 'silent') return;
  const answer = (data) => console.log(JSON.stringify({ type: 'response', id: command.id, success: true, data }));
  if (command.type === 'get_state') {
    if (mode === 'sandbox-removed') rmSync(sandbox, { recursive: true, force: true });
    return answer({ sessionFile: `${sandbox}/sessions/never-written.jsonl`, isStreaming: false, pendingMessageCount: 0 });
  }
  answer({});
});
