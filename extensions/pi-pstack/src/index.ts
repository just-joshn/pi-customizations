import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, parseFrontmatter, VERSION } from '@earendil-works/pi-coding-agent';
import { skillCatalog } from './catalog.ts';
import { registerCommands, registerNativeInput } from './commands.ts';
import { registerContext, registerStatus } from './context.ts';
import { registerGoal } from './goal.ts';
import { hostInstructions } from './host.ts';
import { hostVersionNotice } from './host-version.ts';
import { FIRST_ACTION_RULE_TYPE, firstActionRule, usesAnthropicMessages } from './mode-rule.ts';
import { readModelRule } from './models.ts';
import { registerQuestions } from './questions.ts';
import { registerRoutines } from './routines.ts';
import { registerSetupTool } from './setup-tool.ts';
import { registerShells } from './shells.ts';
import { createState, registerStateTools } from './state.ts';
import { registerTimers } from './timers.ts';
import { registerWorkers } from './workers.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

async function loadSkill(name: string) {
  const path = join(root, 'skills', name, 'SKILL.md');
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(await readFile(path, 'utf8'));
  if (typeof frontmatter.description !== 'string') throw new Error(`Missing description in ${path}`);
  return { path, body, description: frontmatter.description };
}

async function testedHostVersion() {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return String(manifest.devDependencies['@earendil-works/pi-coding-agent']);
}

async function listPlaybooks(dir: string) {
  return (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
}

async function loadModeSource() {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(await readFile(join(root, 'upstream/skills/poteto-mode/SKILL.md'), 'utf8'));
  if (typeof frontmatter.reminder !== 'string' || typeof frontmatter.name !== 'string') throw new Error('Missing poteto-mode name or reminder in the upstream source.');
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return { reminder: frontmatter.reminder, badge: { name: frontmatter.name, icon: text(frontmatter.icon), color: text(frontmatter.color) } };
}

export default async function pstack(pi: ExtensionAPI) {
  const [[mode, setup], { reminder, badge }, catalog, testedVersion] = await Promise.all([
    Promise.all(['poteto-mode', 'setup-pstack'].map(loadSkill)),
    loadModeSource(),
    skillCatalog(root, process.env.PI_PSTACK_WORKER_OWNER ? 'cloud' : 'local'),
    testedHostVersion(),
  ]);
  if (!mode || !setup) throw new Error('Missing pstack resource. Run bun run generate.');
  const skills = new Map([
    ['poteto-mode', mode],
    ['setup-pstack', setup],
  ]);
  const playbooksDir = join(dirname(mode.path), 'playbooks');
  const rule = firstActionRule({ playbooksDir, playbooks: await listPlaybooks(playbooksDir) });
  const store = createState(pi, badge);
  registerCommands(pi, skills, store);
  registerNativeInput(pi, skills, store);
  registerSetupTool(pi, store);
  const notice = hostVersionNotice(VERSION, testedVersion);
  pi.on('session_start', (_event, ctx) => {
    store.restore(ctx);
    if (notice) ctx.ui.notify(notice, 'warning');
  });
  pi.on('session_tree', (_event, ctx) => store.restore(ctx));
  pi.on('before_agent_start', async (event, ctx) => {
    const state = store.read();
    event.systemPromptOptions.sections.pstack_host = hostInstructions(root, ctx, await readModelRule(ctx.cwd), catalog);
    if (state.enabled) event.systemPromptOptions.sections.pstack_mode = `${reminder}\n\nReferences are relative to ${dirname(mode.path)}.\n\n${mode.body}`;
    else delete event.systemPromptOptions.sections.pstack_mode;
    if (state.todos.length) event.systemPromptOptions.sections.pstack_todos = JSON.stringify(state.todos);
    else delete event.systemPromptOptions.sections.pstack_todos;
    if (state.enabled && usesAnthropicMessages(ctx.model)) return { message: { customType: FIRST_ACTION_RULE_TYPE, content: rule, display: false } };
  });
  registerStateTools(pi, store);
  registerQuestions(pi);
  registerContext(pi);
  registerStatus(pi, store);
  registerWorkers(pi);
  registerShells(pi);
  registerGoal(pi);
  registerTimers(pi);
  registerRoutines(pi);
}
