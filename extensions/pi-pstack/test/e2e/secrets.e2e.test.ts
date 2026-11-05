import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { makeSandbox, runJson, script, startRpc, toolEnds } from './harness.ts';

test('request_secret stores what the user types in the connector file and never returns it to the model (G4)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const rpc = startRpc(sandbox);
  onTestFinished(() => rpc.close());
  rpc.send({ type: 'prompt', message: script([{ tool: 'request_secret', args: { label: 'Slack bot token', connector: 'slack', field: 'token' } }]) });
  const asked = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'input');
  expect(asked['title']).toBe('Secret requested: Slack bot token');
  rpc.send({ type: 'extension_ui_response', id: asked['id'], value: '  xoxb-SECRET-VALUE  ' });
  await rpc.waitFor((event) => event.type === 'agent_settled');
  const [result] = toolEnds(rpc.events, 'request_secret');
  const file = join(sandbox.agentDir, 'pstack/connectors/slack/credentials.json');
  expect(result?.text).toBe(`Stored Slack bot token in ${file} under "token". The value is not shown here; copy it from that file with a command that does not print it.`);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ token: 'xoxb-SECRET-VALUE' });
  expect(JSON.stringify(rpc.events.filter((event) => event.type !== 'extension_ui_request'))).not.toContain('xoxb-SECRET-VALUE');
});

test('request_secret fails where nobody can type a secret (G4)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const run = await runJson(sandbox, script([{ tool: 'request_secret', args: { label: 'key', connector: 'bot', field: 'key' } }]), ['--no-session']);
  const [result] = toolEnds(run.events, 'request_secret');
  expect([result?.isError, result?.text]).toEqual([true, 'Nobody can enter a secret in this run. Ask the user to run /secret in an interactive chat, or to set the value in the environment.']);
});
