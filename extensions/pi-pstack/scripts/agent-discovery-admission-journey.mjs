import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const probeFields = ['description', 'prompt', 'subagent_type', 'model', 'run_in_background', 'isolation'];
const budgetMessage = 'Budget limit reached ($0.02 spent of the $0.01 maximum). New agents cannot be started. Complete the remaining work directly with your tools, or wrap up with the results you already have.';

function offeredAgentFields(request) {
  const tools = (request?.messages ?? []).flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : []));
  const agent = tools.find((tool) => tool.name === 'Agent');
  return Object.keys(agent?.parameters?.properties ?? agent?.inputSchema?.properties ?? {});
}

async function withPi(startPi, ctx, prefix, args, env, run) {
  const log = await mkdtemp(join(ctx.log, prefix));
  const client = await startPi(ctx.directory, log, ['--no-session', ...args], env);
  try {
    await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    await run(client);
  } finally {
    await client.finish().catch(() => {});
    await client.close().catch(() => {});
    await rm(log, { recursive: true, force: true });
  }
}

export function agentDiscoveryAdmissionJourney(check, startPi) {
  return async function journeyAgentDiscoveryAdmission(ctx) {
    await withPi(startPi, ctx, 'schema-', [], { CLAUDE_CODE_SIMPLE: '' }, async (client) => {
      const fields = offeredAgentFields(await client.turn('JOURNEY:schemaprobe'));
      check('RPC: the offered Agent schema matches the Provider CLI probe fields', JSON.stringify(fields) === JSON.stringify(probeFields), JSON.stringify(fields));
      const alias = (await client.callTool('JOURNEY:legacyalias')).find((message) => message.toolName === 'Task');
      check('RPC: a Task call carrying the Agent contract launches the Agent type', alias?.isError !== true && alias?.details?.status === 'completed' && alias?.details?.agentType === 'Explore', JSON.stringify(alias).slice(0, 400));
    });
    await withPi(startPi, ctx, 'nobg-', [], { CLAUDE_CODE_SIMPLE: '', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, async (client) => {
      const fields = offeredAgentFields(await client.turn('JOURNEY:schemaprobe'));
      check('RPC: disabled background tasks drop run_in_background from the offer', fields.length > 0 && !fields.includes('run_in_background'), JSON.stringify(fields));
    });
    await withPi(startPi, ctx, 'budget-', ['--max-budget-usd', '0.01'], { CLAUDE_CODE_SIMPLE: '' }, async (client) => {
      await client.run('JOURNEY:costly');
      await client.run('JOURNEY:agent');
      const refused = (await client.messages()).find((message) => message.toolName === 'Agent');
      check('RPC: an exhausted --max-budget-usd refuses the Agent call with the recovered message', refused?.isError === true && JSON.stringify(refused).includes(budgetMessage), JSON.stringify(refused).slice(0, 400));
    });
  };
}
