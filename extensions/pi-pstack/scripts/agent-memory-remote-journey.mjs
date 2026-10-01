import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function agentMemoryRemoteJourney(check, startPi) {
  return async function journeyAgentMemoryRemote(ctx) {
    for (const scenario of [
      { disabled: '', directory: '', enabled: false },
      { disabled: 'false', directory: '', enabled: true },
      { disabled: '', directory: '/remote-memory', enabled: true },
    ]) {
      const log = await mkdtemp(join(ctx.log, 'memory-remote-'));
      const definitions = JSON.stringify({ 'probe-worker': { description: 'Remote memory probe', prompt: 'Complete the task.', tools: ['grep'], model: 'inherit', memory: 'project' } });
      const client = await startPi(ctx.directory, log, ['--no-session', '--agents', definitions], {
        CLAUDE_CODE_REMOTE: '1',
        CLAUDE_CODE_REMOTE_MEMORY_DIR: scenario.directory,
        CLAUDE_COWORK_MEMORY_PATH_OVERRIDE: '',
        CLAUDE_CODE_SIMPLE: '',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: scenario.disabled,
      });
      try {
        await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
        const result = (await client.callTool('JOURNEY:agentjson')).find((message) => message.toolName === 'Agent');
        check(`RPC: remote memory scenario ${JSON.stringify(scenario)} completes`, result?.isError !== true && result?.details?.status === 'completed', JSON.stringify(result).slice(0, 400));
        const child = (await client.everyRequest()).find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('Report JSON definition.')));
        const system = child?.messages.filter((message) => message.role === 'system') ?? [];
        check(`RPC: remote memory enabled ${scenario.enabled} matches actual child instructions`, child !== undefined && JSON.stringify(system).includes('Persistent Agent Memory') === scenario.enabled, JSON.stringify(system).slice(0, 400));
        const tools = system.flatMap((message) => message.toolsAdded?.map((tool) => tool.name) ?? []);
        check(`RPC: remote memory enabled ${scenario.enabled} matches exact tool grants`, JSON.stringify(tools) === JSON.stringify(scenario.enabled ? ['grep', 'read', 'write', 'edit'] : ['grep']), JSON.stringify(tools));
      } finally {
        await client.finish().catch(() => {});
        await client.close().catch(() => {});
        await rm(log, { recursive: true, force: true });
      }
    }
  };
}
