import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function agentDepthSettingJourney(check, startPi) {
  return async function journeyAgentDepthSetting(ctx) {
    const file = join(ctx.directory, '.pi/settings.json');
    const before = await readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    const log = await mkdtemp(join(ctx.log, 'depth-setting-'));
    let client;
    try {
      await mkdir(join(ctx.directory, '.pi'), { recursive: true });
      await writeFile(file, JSON.stringify({ ...(before === undefined ? {} : JSON.parse(before)), pstack: { maxSubagentSpawnDepth: 1 } }));
      client = await startPi(ctx.directory, log, ['--no-session'], { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '', PI_MAX_SUBAGENT_SPAWN_DEPTH: '', CLAUDE_CODE_SIMPLE: '' });
      await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
      const result = (await client.callTool('JOURNEY:legacydepth')).find((message) => message.toolName === 'Agent');
      check('RPC: configured depth fallback permits the first child', result?.isError !== true && result?.details?.status === 'completed', JSON.stringify(result).slice(0, 400));
      const requests = await client.everyRequest();
      const child = requests.find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:legacydepth-child')));
      const tools = child?.messages.filter((message) => message.role === 'system').flatMap((message) => message.toolsAdded?.map((tool) => tool.name) ?? []) ?? [];
      check('RPC: configured depth fallback masks both launch tools', child !== undefined && !tools.includes('Agent') && !tools.includes('Task'), JSON.stringify(tools));
      const refusal = requests.flatMap((request) => request.messages).find((message) => message.role === 'toolResult' && message.toolName === 'Task');
      check(
        'RPC: configured fallback prevents the actual legacy leaf',
        refusal?.isError === true && !requests.some((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:legacydepth-leaf'))),
        JSON.stringify(refusal).slice(0, 400),
      );
    } finally {
      if (client) {
        await client.finish().catch(() => {});
        await client.close().catch(() => {});
      }
      if (before === undefined) await rm(file, { force: true });
      else await writeFile(file, before);
      await rm(log, { recursive: true, force: true });
    }
  };
}
