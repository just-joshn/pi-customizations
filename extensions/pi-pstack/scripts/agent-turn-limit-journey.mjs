import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function lastUserText(request) {
  const user = request.messages?.findLast((message) => message.role === 'user');
  if (typeof user?.content === 'string') return user.content;
  return (
    user?.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('') ?? ''
  );
}

export function agentTurnLimitJourney(startPi, check) {
  return async function journeyAgentTurnLimit(ctx) {
    const dir = join(ctx.directory, '.pi/agents');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'bounded-turn-probe.md'), '---\nname: bounded-turn-probe\ndescription: native turn limit probe\nmaxTurns: 2\n---\nFollow the child probe.');
    const client = await startPi(ctx.directory, ctx.log, ['--no-session']);
    try {
      await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
      const messages = await client.callTool('JOURNEY:agentturnlimit');
      const result = messages.find((message) => message.toolName === 'Agent');
      check('RPC: bounded Agent returns a tool error at its turn limit', result?.isError === true && JSON.stringify(result).includes('interrupted'), JSON.stringify(result).slice(0, 300));
      const requests = await client.requests();
      const child = requests.filter((request) => lastUserText(request) === 'JOURNEY:progress-child');
      check('RPC: definition maxTurns two permits exactly two child queries', child.length === 2, `child queries=${child.length}`);
    } finally {
      await client.finish().catch(() => {});
      await client.close().catch(() => {});
    }
  };
}
