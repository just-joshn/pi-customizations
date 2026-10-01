import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function agentAppendJourney(check, startPi) {
  return async function journeyAgentAppend(ctx) {
    for (const enabled of [undefined, '1', '0']) {
      const log = await mkdtemp(join(ctx.log, 'append-'));
      const client = await startPi(ctx.directory, log, ['--no-session', '--append-subagent-system-prompt', 'APPEND_NESTED_SENTINEL'], { CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: enabled });
      try {
        await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
        const result = (await client.callTool('JOURNEY:append-parent')).find((message) => message.toolName === 'Task');
        check(`RPC: append gate ${enabled} completes the nested Task journey`, result?.isError !== true && result?.details?.status === 'settled', JSON.stringify(result).slice(0, 400));
        const requests = await client.everyRequest();
        for (const prompt of ['JOURNEY:append-child', 'JOURNEY:append-grandchild']) {
          const child = requests.find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes(prompt)));
          const system = JSON.stringify(child?.messages.filter((message) => message.role === 'system')) ?? '';
          check(`RPC: ${prompt} honors append gate ${enabled}`, child !== undefined && system.includes('APPEND_NESTED_SENTINEL') === (enabled === '1'), system.slice(0, 400));
        }
      } finally {
        await client.finish().catch(() => {});
        await client.close().catch(() => {});
        await rm(log, { recursive: true, force: true });
      }
    }
  };
}
