import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { registerCommands, registerNativeInput } from './commands.ts';
import { registerContext, registerStatus } from './context.ts';
import { hostInstructions } from './host.ts';
import { readModelRule } from './models.ts';
import { registerQuestions } from './questions.ts';
import { registerEventFlags } from './subagents/sdk-events.ts';
import { registerShells } from './shells.ts';
import { createState, registerStateTools } from './state.ts';
import { registerWorkers } from './workers.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

async function loadSkill(name: string) {
  const path = join(root, 'skills', name, 'SKILL.md');
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(await readFile(path, 'utf8'));
  if (typeof frontmatter.description !== 'string') throw new Error(`Missing description in ${path}`);
  return { path, body, description: frontmatter.description };
}

export default async function pstack(pi: ExtensionAPI) {
  pi.registerFlag('append-subagent-system-prompt', { type: 'string', description: 'Append native child system instructions when CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT is enabled.' });
  registerEventFlags(pi);
  pi.registerFlag('agents', { type: 'string', description: 'JSON map of native agent definitions for this session.' });
  pi.registerFlag('add-dir', { type: 'string', description: 'Additional project directories whose .pi/agents and .claude/agents definitions load, separated by the path delimiter.' });
  pi.registerFlag('max-budget-usd', { type: 'string', description: 'Maximum session spend in USD; new subagents are refused once it is reached.' });
  const [mode, setup] = await Promise.all(['poteto-mode', 'setup-pstack'].map(loadSkill));
  if (!mode || !setup) throw new Error('Missing pstack resource. Run bun run generate.');
  const skills = new Map([
    ['poteto-mode', mode],
    ['setup-pstack', setup],
  ]);
  const store = createState(pi);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  pi.on('session_start', (_event, ctx) => store.restore(ctx));
  pi.on('session_tree', (_event, ctx) => store.restore(ctx));
  pi.on('before_agent_start', async (event, ctx) => {
    const state = store.read();
    event.systemPromptOptions.sections.pstack_host = hostInstructions(root, ctx, await readModelRule());
    if (state.enabled) event.systemPromptOptions.sections.pstack_mode = `References are relative to ${dirname(mode.path)}.\n\n${mode.body}`;
    else delete event.systemPromptOptions.sections.pstack_mode;
    if (state.todos.length) event.systemPromptOptions.sections.pstack_todos = JSON.stringify(state.todos);
    else delete event.systemPromptOptions.sections.pstack_todos;
  });
  registerStateTools(pi, store);
  registerQuestions(pi);
  registerContext(pi);
  registerStatus(pi, store);
  registerWorkers(pi);
  registerShells(pi);
}
