import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function agentJsonInheritanceJourney(check, startPi) {
  return async function journeyAgentJsonInheritance(ctx) {
    const log = await mkdtemp(join(ctx.log, 'json-inheritance-'));
    const definitions = JSON.stringify({
      'json-parent': { description: 'JSON parent', prompt: 'Launch the requested leaf.', tools: ['Agent'] },
      'json-leaf': { description: 'JSON leaf', prompt: 'JSON_NESTED_LEAF_SYSTEM_SENTINEL', tools: ['read'], model: 'inherit' },
    });
    const client = await startPi(ctx.directory, log, ['--no-session', '--agents', definitions]);
    try {
      await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
      const result = (await client.callTool('JOURNEY:agentjsonnested')).find((message) => message.toolName === 'Agent');
      check('RPC: JSON-defined parent completes', result?.isError !== true && result?.details?.status === 'completed', JSON.stringify(result).slice(0, 400));
      const requests = await client.everyRequest();
      const leaf = requests.find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:agentjsonnested-leaf')));
      check(
        'RPC: nested JSON leaf uses inherited model and definition prompt',
        leaf?.model === 'recorder' && JSON.stringify(leaf.messages.filter((message) => message.role === 'system')).includes('JSON_NESTED_LEAF_SYSTEM_SENTINEL'),
        JSON.stringify(leaf).slice(0, 400),
      );
      const tools = leaf?.messages.filter((message) => message.role === 'system').flatMap((message) => message.toolsAdded?.map((tool) => tool.name) ?? []) ?? [];
      check('RPC: nested JSON leaf receives its exact tool pool', JSON.stringify(tools) === JSON.stringify(['read']), JSON.stringify(tools));
      const nested = requests.flatMap((request) => request.messages).find((message) => message.role === 'toolResult' && message.toolName === 'Agent' && message.details?.agentType === 'json-leaf');
      check('RPC: nested JSON admission returns completed leaf', nested?.isError === false && nested.details.status === 'completed', JSON.stringify(nested).slice(0, 400));
    } finally {
      await client.finish().catch(() => {});
      await client.close().catch(() => {});
      await rm(log, { recursive: true, force: true });
    }
  };
}
