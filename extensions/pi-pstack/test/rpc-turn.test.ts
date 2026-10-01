import { spawn } from 'node:child_process';

import { expect, test } from 'vitest';
import { rpcProcess } from '../scripts/rpc-process.mjs';
import { promptAndSettle } from '../scripts/rpc-turn.mjs';

test('RPC acknowledgement is not settlement', async () => {
  const child = spawn(process.execPath, [
    '-e',
    `
    const readline = require('node:readline');
    let busy = false;
    readline.createInterface({input:process.stdin}).on('line', line => {
      const c = JSON.parse(line);
      const out = value => process.stdout.write(JSON.stringify(value)+'\\n');
      if(c.type === 'prompt') { if(busy) return out({type:'response',id:c.id,success:false,error:'already processing'}); busy = true; }
      if(c.type === 'end') out({type:'agent_end'});
      if(c.type === 'settle') { busy = false; out({type:'agent_settled'}); }
      out({type:'response',id:c.id,success:true,data:c.type === 'prompt' ? {disposition:'started'} : {isStreaming:false,pendingMessageCount:0}});
    });
  `,
  ]);
  let settlements = 0;
  const client = rpcProcess(child, {
    requestDeadlineMs: 2000,
    shutdownDeadlineMs: 100,
    onRecord: (record: unknown) => {
      if (record && typeof record === 'object' && 'type' in record && record.type === 'agent_settled') settlements += 1;
    },
  });
  try {
    let completed = false;
    const first = promptAndSettle(
      (command) => client.send(command),
      () => settlements,
      { type: 'prompt', message: 'first' },
      2000,
    ).then((result) => {
      completed = true;
      return result;
    });
    await expect(client.send({ type: 'get_state' })).resolves.toEqual({ isStreaming: false, pendingMessageCount: 0 });
    await client.send({ type: 'end' });
    expect(completed).toBe(false);
    await client.send({ type: 'settle' });
    await expect(first).resolves.toEqual({ disposition: 'started' });
    expect(completed).toBe(true);
    await expect(client.send({ type: 'prompt', message: 'second' })).resolves.toEqual({ disposition: 'started' });
  } finally {
    await client.close();
  }
});

test('handled RPC commands do not require a settlement event', async () => {
  await expect(
    promptAndSettle(
      async () => ({ disposition: 'handled' }),
      () => 0,
      { type: 'prompt', message: '/status' },
      40,
    ),
  ).resolves.toEqual({ disposition: 'handled' });
});

test('missing settlement rejects rather than calling the prompt complete', async () => {
  await expect(
    promptAndSettle(
      async () => ({ disposition: 'started' }),
      () => 0,
      { type: 'prompt', message: 'never settles' },
      40,
    ),
  ).rejects.toThrow('RPC prompt did not settle');
});
