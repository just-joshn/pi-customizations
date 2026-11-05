import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { makeSandbox, script, startRpc, toolEnds } from './harness.ts';

test('a cloud automation fire runs on its own checkout with a memory file, never in the workspace (G3)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const git = (...args: string[]) => execFileSync('git', ['-C', sandbox.workDir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(sandbox.workDir, 'a.txt'), 'A');
  git('add', 'a.txt');
  git('commit', '-qm', 'first');
  const owner = startRpc(sandbox);
  onTestFinished(async () => {
    await owner.close();
    sandbox.dispose();
  });
  const fire = script([{ tool: 'bash', args: { command: 'pwd; git branch --show-current' } }]);
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_timer', args: { name: 'Nightly Check', prompt: fire, delaySeconds: 1, once: true, sessionStrategy: 'new_session', environment: 'cloud' } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  expect(toolEnds(owner.events, 'subscribe_timer')[0]?.isError).toBe(false);
  const notice = await owner.waitFor((event) => event.type === 'message_end' && JSON.stringify(event['message'] ?? {}).includes('kind: subagent'), 60_000);
  const text = JSON.stringify(notice['message']);
  expect(text).toContain('status: success');
  expect(text).toMatch(/\[bash\] [^"\\]*\/worktrees\/[0-9a-f-]{36}\\npstack\/[0-9a-f-]{36}/);
  expect(existsSync(join(sandbox.agentDir, 'pstack/automations/nightly-check'))).toBe(true);
});

test('environment cloud needs a fire that starts its own run (G3)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  const owner = startRpc(sandbox);
  onTestFinished(async () => {
    await owner.close();
    sandbox.dispose();
  });
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_timer', args: { name: 'x', prompt: 'go', delaySeconds: 60, environment: 'cloud' } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  const result = toolEnds(owner.events, 'subscribe_timer')[0];
  expect([result?.isError, result?.text]).toEqual([true, 'environment "cloud" needs sessionStrategy "new_session": a wake_self fire runs in the owning chat.']);
});
