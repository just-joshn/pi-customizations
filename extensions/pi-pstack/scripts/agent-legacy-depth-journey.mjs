import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function agentLegacyDepthJourney(check, startPi) {
  return async function journeyAgentLegacyDepth(ctx) {
    for (const cap of ['1', '2']) {
      const log = await mkdtemp(join(ctx.log, 'legacy-depth-'));
      const client = await startPi(ctx.directory, log, ['--no-session'], { PI_MAX_SUBAGENT_SPAWN_DEPTH: cap, CLAUDE_CODE_SIMPLE: '' });
      try {
        await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
        const result = (await client.callTool('JOURNEY:legacydepth')).find((message) => message.toolName === 'Agent');
        check(`RPC: legacy depth parent completes at cap ${cap}`, result?.isError !== true && result?.details?.status === 'completed', JSON.stringify(result).slice(0, 400));
        const requests = await client.everyRequest();
        const child = requests.find((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:legacydepth-child')));
        const tools = child?.messages.filter((message) => message.role === 'system').flatMap((message) => message.toolsAdded?.map((tool) => tool.name) ?? []) ?? [];
        check(`RPC: legacy Task offer obeys cap ${cap}`, child !== undefined && tools.includes('Task') === (cap === '2'), JSON.stringify(tools));
        const nested = requests.flatMap((request) => request.messages).find((message) => message.role === 'toolResult' && message.toolName === 'Task');
        check(`RPC: legacy Task execution obeys cap ${cap}`, nested !== undefined && nested.isError === (cap === '1'), JSON.stringify(nested).slice(0, 400));
        const leaf = requests.some((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('JOURNEY:legacydepth-leaf')));
        check(`RPC: actual legacy leaf request obeys cap ${cap}`, leaf === (cap === '2'), JSON.stringify({ leaf }));
        if (cap === '2') {
          const statsFiles = (await readdir(log)).filter((name) => name.startsWith('root-stats-'));
          const snapshots = (await Promise.all(statsFiles.map((name) => readFile(join(log, name), 'utf8')))).flatMap((text) =>
            text
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
          );
          const final = snapshots.at(-1);
          check('RPC: root counts nested legacy identity and completion exactly once', final?.spawned === 2 && final?.completed === 2 && final?.failed === 0 && final?.killed === 0 && final?.max_depth === 2, JSON.stringify(final));
        }
      } finally {
        await client.finish().catch(() => {});
        await client.close().catch(() => {});
        await rm(log, { recursive: true, force: true });
      }
    }
  };
}
