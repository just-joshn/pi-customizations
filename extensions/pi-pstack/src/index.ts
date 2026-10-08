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
import { registerFigureItOutPlaybookGate } from './figure-it-out-playbook-gate.ts';
import { registerHowSpawnGate } from './how-spawn-gate.ts';
import { FIRST_ACTION_RULE_TYPE, firstActionRule, usesAnthropicMessages } from './mode-rule.ts';
import { readModelRule } from './models.ts';
import { registerQuestions } from './questions.ts';
import { registerRoutines } from './routines.ts';
import { registerSetupTool } from './setup-tool.ts';
import { registerShells } from './shells.ts';
import { createState, registerStateTools } from './state.ts';
import { loadAllSkills } from './skills-map.ts';
import { registerTimers } from './timers.ts';
import { registerWhySpawnGate } from './why-spawn-gate.ts';
import { registerWorkers } from './workers.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

async function testedHostVersion() {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return String(manifest.devDependencies['@earendil-works/pi-coding-agent']);
}

async function listPlaybooks(dir: string) {
  return (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
}

async function loadModeSource() {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(await readFile(join(root, 'upstream/skills/poteto-mode/SKILL.md'), 'utf8'));
  if (typeof frontmatter['reminder'] !== 'string' || typeof frontmatter['name'] !== 'string') throw new Error('Missing poteto-mode name or reminder in the upstream source.');
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return { reminder: frontmatter['reminder'], badge: { name: frontmatter['name'], icon: text(frontmatter['icon']), color: text(frontmatter['color']) } };
}

export default async function pstack(pi: ExtensionAPI) {
  const environment = process.env['PI_PSTACK_WORKER_OWNER'] ? 'cloud' : 'local';
  const [skills, { reminder, badge }, catalog, testedVersion] = await Promise.all([
    loadAllSkills(root, environment),
    loadModeSource(),
    skillCatalog(root, environment),
    testedHostVersion(),
  ]);
  const mode = skills.get('poteto-mode');
  if (!mode) throw new Error('Missing pstack resource. Run bun run generate.');
  const commandSkills = new Map([...skills].filter(([name]) => name === 'poteto-mode' || name === 'setup-pstack'));
  const playbooksDir = join(dirname(mode.path), 'playbooks');
  const rule = firstActionRule({ playbooksDir, playbooks: await listPlaybooks(playbooksDir) });
  const store = createState(pi, badge);
  registerCommands(pi, commandSkills, store);
  registerNativeInput(pi, skills, store);
  registerSetupTool(pi);
  const notice = hostVersionNotice(VERSION, testedVersion);
  pi.on('session_start', (_event, ctx) => {
    store.restore(ctx);
    if (notice) ctx.ui.notify(notice, 'warning');
  });
  pi.on('session_tree', (_event, ctx) => store.restore(ctx));
  pi.on('before_agent_start', async (event, ctx) => {
    const state = store.read();
    event.systemPromptOptions.sections['pstack_host'] = hostInstructions(root, ctx, await readModelRule(ctx.cwd), catalog);
    if (state.enabled) event.systemPromptOptions.sections['pstack_mode'] = `${reminder}\n\nReferences are relative to ${dirname(mode.path)}.\n\n${mode.body}`;
    else delete event.systemPromptOptions.sections['pstack_mode'];
    if (state.todos.length) event.systemPromptOptions.sections['pstack_todos'] = JSON.stringify(state.todos);
    else delete event.systemPromptOptions.sections['pstack_todos'];
    if (state.enabled && usesAnthropicMessages(ctx.model)) return { message: { customType: FIRST_ACTION_RULE_TYPE, content: rule, display: false } };
    return undefined;
  });
  registerStateTools(pi, store);
  registerQuestions(pi);
  registerContext(pi);
  registerStatus(pi, store);
  registerWorkers(pi);
  registerHowSpawnGate(pi);
  registerWhySpawnGate(pi);
  registerFigureItOutPlaybookGate(pi);
  registerShells(pi);
  registerGoal(pi);
  registerTimers(pi);
  registerRoutines(pi);
}
