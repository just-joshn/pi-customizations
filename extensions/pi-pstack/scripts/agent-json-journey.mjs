import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { toolNames } from './journey-requests.mjs';

export function agentJsonJourney(check, startPi) {
  return async function journeyAgentJson(ctx) {
    const definitions = JSON.stringify({ 'probe-worker': { description: 'JSON probe', prompt: 'Complete the task.', tools: ['Read'], model: ' INHERIT ', memory: 'project', criticalSystemReminder_EXPERIMENTAL: 'CRITICAL_JSON_SENTINEL' } });
    const log = await mkdtemp(join(ctx.log, 'json-'));
    const client = await startPi(ctx.directory, log, ['--no-session', '--agents', definitions]);
    try {
      await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
      const result = (await client.callTool('JOURNEY:agentjson')).find((message) => message.toolName === 'Agent');
      check('RPC: --agents selects a JSON-defined native child', result?.isError !== true && result?.details?.status === 'completed' && result.details.agentType === 'probe-worker', JSON.stringify(result).slice(0, 400));
      const requests = await client.everyRequest();
      const child = requests.find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('Report JSON definition.')));
      const system = JSON.stringify(child?.messages.filter((message) => message.role === 'system')) ?? '';
      check(
        'RPC: JSON memory reaches the native child prompt and tool pool',
        system.includes('Persistent Agent Memory') && system.includes('project-scope') && ['edit', 'read', 'write'].every((name) => toolNames(child).includes(name)),
        system.slice(0, 400),
      );
      check('RPC: JSON critical reminder reaches actual child system input', system.includes('CRITICAL_JSON_SENTINEL') && system.includes('critical-system-reminder'), system.slice(0, 400));
      check(
        'RPC: JSON child inherits native model and produces actual output',
        result?.details?.resolvedModel === 'journey-test/recorder' && result.details.content?.[0]?.text.startsWith('recorded Report JSON definition.'),
        JSON.stringify(result).slice(0, 400),
      );
    } finally {
      await client.finish().catch(() => {});
      await client.close().catch(() => {});
      await rm(log, { recursive: true, force: true });
    }
  };
}
