import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const statusScript = `let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  require('node:fs').writeFileSync('status-stdin.json', input);
  for (const task of JSON.parse(input).tasks) process.stdout.write(JSON.stringify({ id: task.id, content: 'STATUS-OK' }) + '\\n');
});
`;

async function journeyDirectory(ctx) {
  const directory = await realpath(await mkdtemp(join(ctx.directory, 'worktree-ui-')));
  await mkdir(join(directory, 'extensions'), { recursive: true });
  await copyFile(join(ctx.directory, 'extensions', 'journey-provider.ts'), join(directory, 'extensions', 'journey-provider.ts'));
  await writeFile(join(directory, 'status.cjs'), statusScript);
  const hooked = join(directory, 'hooked');
  const settings = {
    subagentStatusLine: { type: 'command', command: `node ${join(directory, 'status.cjs')}` },
    hooks: { WorktreeCreate: [{ hooks: [{ type: 'command', command: `mkdir -p ${hooked} && echo ${hooked}` }] }] },
  };
  await writeFile(join(directory, 'settings.json'), JSON.stringify(settings));
  return { directory, hooked };
}

function panelLines(client) {
  return client.ui.filter((request) => request.method === 'setWidget' && request.widgetKey === 'pstack-agents').map((request) => request.widgetLines ?? []);
}

async function checkPanel(client, directory, check) {
  await client.callTool('JOURNEY:agentslow');
  const panels = panelLines(client).map((lines) => lines.join(' | '));
  check('RPC: the agent task panel shows the running Agent from the registry', panels.includes('● general-purpose: slow probe'), panels.join(' || '));
  check('RPC: the subagentStatusLine output decorates the running Agent row', panels.includes('● general-purpose: slow probe · STATUS-OK'), panels.join(' || '));
  check('RPC: the task panel redraws the Agent as finished', panels.at(-1)?.startsWith('✓ general-purpose: slow probe') === true, panels.join(' || '));
  const stdin = JSON.parse(await readFile(join(directory, 'status-stdin.json'), 'utf8').catch(() => '{}'));
  const task = stdin.tasks?.[0];
  check(
    'RPC: the status-line command receives project, terminal and task data on stdin',
    stdin.cwd === directory &&
      typeof stdin.columns === 'number' &&
      task?.type === 'local_agent' &&
      task.status === 'running' &&
      task.description === 'slow probe' &&
      task.model === 'journey-test/recorder' &&
      typeof task.startTime === 'number' &&
      Array.isArray(task.tokenSamples),
    JSON.stringify(stdin).slice(0, 400),
  );
}

async function checkHookedWorktree(client, hooked, check) {
  const messages = await client.callTool('JOURNEY:agenthooked');
  const result = messages.find((message) => message.toolName === 'Agent');
  check('RPC: a WorktreeCreate hook supplies the Agent checkout outside git', result?.isError !== true && result?.details?.worktreePath === hooked && result.details.effectiveIsolation === 'worktree', JSON.stringify(result).slice(0, 400));
}

export function agentWorktreeUiJourney(check, startPi) {
  return async function journeyAgentWorktreeUi(ctx) {
    const { directory, hooked } = await journeyDirectory(ctx);
    const log = await mkdtemp(join(ctx.log, 'worktree-ui-'));
    const client = await startPi(directory, log, ['--no-session', '--no-context-files']);
    try {
      await client.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
      await checkPanel(client, directory, check);
      await checkHookedWorktree(client, hooked, check);
    } finally {
      await client.finish().catch(() => {});
      await client.close().catch(() => {});
      await rm(log, { recursive: true, force: true });
    }
  };
}
