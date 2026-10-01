import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function agentSimpleJourney(check, startPi) {
  return async function journeyAgentSimple(ctx) {
    const log = await mkdtemp(join(ctx.log, 'simple-'));
    const client = await startPi(ctx.directory, log, ['--no-session', '--no-context-files'], { CLAUDE_CODE_SIMPLE: '1' });
    try {
      await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
      const results = await client.callTool('JOURNEY:agentsimple');
      const requests = await client.everyRequest();
      const root = requests.find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:agentsimple')));
      const tools = root?.messages.filter((message) => message.role === 'system').flatMap((message) => message.toolsAdded?.map((tool) => tool.name) ?? []);
      check('RPC: simple mode offers exactly Read', root !== undefined && JSON.stringify(tools) === JSON.stringify(['read']), JSON.stringify(tools));
      check('RPC: simple mode does not expose Agent schema', root !== undefined && !tools.includes('Agent'), JSON.stringify(tools));
      check(
        'RPC: unavailable delegation produces no child model request',
        !requests.some((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('SIMPLE_MUST_NOT_RUN_CHILD'))),
        JSON.stringify(results).slice(0, 400),
      );
      check(
        'RPC: unavailable delegation is refused by native execution',
        results.some((message) => message.toolName === 'Agent' && message.isError === true),
        JSON.stringify(results).slice(0, 400),
      );
      await client.send({ type: 'prompt', message: '/journey-simple-off' });
      const restored = (await client.callTool('JOURNEY:agentrestored')).find((message) => message.toolName === 'Agent');
      const later = await client.everyRequest();
      const rootAfter = later.find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:agentrestored')));
      const restoredTools = rootAfter?.messages.filter((message) => message.role === 'system').flatMap((message) => message.toolsAdded?.map((tool) => tool.name) ?? []) ?? [];
      check('RPC: clearing simple mode restores actual launch declarations on the next turn', restoredTools.includes('Agent') && restoredTools.includes('Task'), JSON.stringify(restoredTools));
      check(
        'RPC: restored offer executes the known Agent and child request',
        restored?.isError !== true &&
          restored?.details?.status === 'completed' &&
          later.some((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:restored-offer-child'))),
        JSON.stringify(restored).slice(0, 400),
      );
    } finally {
      await client.finish().catch(() => {});
      await client.close().catch(() => {});
      await rm(log, { recursive: true, force: true });
    }
  };
}
