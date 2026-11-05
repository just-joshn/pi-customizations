import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { makeSandbox, startRpc } from './harness.ts';

function repo(cwd: string): void {
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(cwd, 'a.txt'), 'A');
  git('add', 'a.txt');
  git('commit', '-qm', 'first');
}

const messageText = (event: Record<string, unknown>) => JSON.stringify(event['message'] ?? {});

test('/in-cloud sends the next submitted task to a cloud agent instead of this chat, and its result comes back (G1)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  repo(sandbox.workDir);
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  rpc.send({ id: 'arm', type: 'prompt', message: '/in-cloud' });
  await rpc.waitFor((event) => event.type === 'response' && event['id'] === 'arm');
  rpc.send({ id: 'task', type: 'prompt', message: 'go\n@@say FROM-THE-CLOUD' });
  await rpc.waitFor((event) => event.type === 'response' && event['id'] === 'task');
  const sent = await rpc.waitFor((event) => event.type === 'message_end' && messageText(event).includes('Sent to a cloud agent'), 60_000);
  const agentId = /Sent to a cloud agent \(([0-9a-f-]{36})\)/.exec(messageText(sent))?.[1];
  expect(agentId).toMatch(/^[0-9a-f-]{36}$/);
  const notice = await rpc.waitFor((event) => event.type === 'message_end' && messageText(event).includes(`task_id: ${agentId}`), 60_000);
  expect(messageText(notice)).toContain('status: success');
  expect(messageText(notice)).toContain('FROM-THE-CLOUD');
  const userTexts = rpc.events.filter((event) => event.type === 'message_end' && (event['message'] as { role?: string } | undefined)?.role === 'user').map(messageText);
  expect(userTexts.some((text) => text.includes('FROM-THE-CLOUD'))).toBe(false);
});
