import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { parseFrontmatter, SessionManager, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { modelConfigPath, readModelRule, setupModels } from './models.ts';
import { registerWorkers } from './workers.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const Todo = Type.Object({
  id: Type.String({ minLength: 1 }),
  content: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')]),
});
const State = Type.Object({ enabled: Type.Boolean(), todos: Type.Array(Todo), verificationOffered: Type.Optional(Type.Boolean()) });
type State = Static<typeof State>;
const result = (text: string, details: unknown = undefined) => ({ content: [{ type: 'text' as const, text }], details });

export default async function pstack(pi: ExtensionAPI) {
  const skills = new Map<string, { path: string; body: string; description: string }>();
  for (const item of await readdir(join(root, 'skills'), { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const path = join(root, 'skills', item.name, 'SKILL.md');
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(await readFile(path, 'utf8'));
    if (typeof frontmatter.description !== 'string') throw new Error(`Missing description in ${path}`);
    skills.set(item.name, { path, body, description: frontmatter.description });
  }
  const mode = skills.get('poteto-mode');
  if (!mode) throw new Error('Missing poteto-mode resource. Run npm run generate.');
  let state: State = { enabled: false, todos: [] };

  const showState = (ctx: ExtensionContext) => {
    ctx.ui.setStatus('pstack', state.enabled ? 'poteto-mode' : undefined);
    ctx.ui.setWidget('pstack-todos', state.todos.length
      ? state.todos.map((todo) => `${todo.status === 'completed' ? '[x]' : '[ ]'} ${todo.content} (${todo.status})`)
      : undefined);
  };
  const restore = (ctx: ExtensionContext) => {
    state = { enabled: false, todos: [] };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === 'pstack-state' && Check(State, entry.data)) state = entry.data;
    }
    showState(ctx);
  };
  const persist = (ctx: ExtensionContext) => {
    pi.appendEntry('pstack-state', state);
    showState(ctx);
  };
  const toggle = (enabled: boolean, ctx: ExtensionContext) => {
    state = { ...state, enabled };
    persist(ctx);
  };
  const expand = (name: string, args: string) => {
    const skill = skills.get(name);
    if (!skill) throw new Error(`Unknown pstack skill ${name}`);
    return `<skill name="${name}" location="${skill.path}">\nReferences are relative to ${dirname(skill.path)}.\n\n${skill.body}\n</skill>${args ? `\n\n${args}` : ''}`;
  };
  const setup = async (ctx: ExtensionContext) => {
    if (!await setupModels(ctx)) return;
    if (state.verificationOffered) return;
    state = { ...state, verificationOffered: true };
    persist(ctx);
    pi.sendUserMessage([
      'The user completed /setup-pstack and confirmed the model configuration. Only its optional verification step remains.',
      'Inspect this project for an existing verification skill or a harness that drives the real app. A globally installed verify skill does not establish project coverage.',
      'If there is no such project capability, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill."',
      `Wait for the user to accept before invoking ${skills.get('create-verification-skill')?.path}. If a harness exists or the user declines, finish setup without creating one.`,
    ].join('\n'), { deliverAs: 'followUp' });
  };
  const handleSetup = async (ctx: ExtensionContext) => {
    try { await setup(ctx); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(message, 'error');
      pi.sendMessage({ customType: 'pstack-setup-error', display: true, content: message });
    }
  };
  for (const [name, skill] of skills) {
    pi.registerCommand(name, {
      description: skill.description,
      handler: async (args, ctx) => {
        if (name === 'setup-pstack') {
          await handleSetup(ctx);
          return;
        }
        if (name === 'poteto-mode') {
          if (args.trim() === 'off') {
            toggle(false, ctx);
            ctx.ui.notify('Poteto mode is off.', 'info');
            return;
          }
          toggle(true, ctx);
        }
        pi.sendUserMessage(expand(name, args), { deliverAs: 'followUp' });
      },
    });
  }
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));
  pi.on('input', async (event, ctx) => {
    const native = event.text.match(/^\/skill:(poteto-mode|setup-pstack)(?:\s+([\s\S]*))?$/);
    if (native) {
      const name = native[1];
      const args = native[2] ?? '';
      const discovered = pi.getCommands().find((command) => command.source === 'skill' && command.name === `skill:${name}`);
      if (discovered && discovered.sourceInfo.path !== skills.get(name)?.path) return { action: 'continue' };
      if (name === 'setup-pstack') {
        await handleSetup(ctx);
        return { action: 'handled' };
      }
      toggle(args.trim() !== 'off', ctx);
      if (args.trim() === 'off') return { action: 'handled' };
      return { action: 'transform', text: expand(name, args), images: event.images };
    }
    const setupSkill = skills.get('setup-pstack');
    if (setupSkill && event.text.startsWith('<skill name="setup-pstack" location="') && event.text.includes(`location="${setupSkill.path}"`)) {
      await handleSetup(ctx);
      return { action: 'handled' };
    }
    if (event.text.startsWith('<skill name="poteto-mode" location="') && event.text.includes(`location="${mode.path}"`)) {
      const request = event.text.split('</skill>')[1]?.trim();
      toggle(request !== 'off', ctx);
      if (request === 'off') return { action: 'handled' };
    }
    return { action: 'continue' };
  });
  pi.on('before_agent_start', async (event, ctx) => {
    const rule = await readModelRule();
    event.systemPromptOptions.sections.pstack_host = [
      'pstack pi host contract. Follow the bundled workflow instructions in full. Preserve their gates and report missing dependencies.',
      `Bundled skills: ${join(root, 'skills')}. Immutable source including agents and dormant Benny pack: ${join(root, 'upstream')}.`,
      `Read model role overrides at ${modelConfigPath()}. This is the Pi mapping of ~/.cursor/rules/pstack-models.mdc. The active rule follows:\n${rule || 'No override. Upstream defaults remain requests, not confirmed available models.'}`,
      'Task, TaskOutput, TaskMessage, TaskStop implement local delegation. Use exact available provider/model IDs, optionally :thinking. auto and inherit-parent inherit the parent. Unavailable Cursor slugs fail with available choices. Follow the source fallback policy and report any model change.',
      'Cloud Task execution is unavailable. Never silently replace a required cloud task with local execution. Readonly workers have restricted tools, not an OS sandbox. Agent-mode workers use installed Pi extensions; their tool availability depends on those extensions.',
      'TodoWrite keeps the verbatim ordered playbook steps. AskQuestion is available only with interactive or RPC dialogs. Cancellation is not approval.',
      'pstack_mode changes sticky mode on explicit user entry or opt-out. Recognize natural-language user requests through that tool, not quoted examples. Only apply the active mode to tasks matching its own scope.',
      'Use pstack_context for this Pi session and workspace history. Cursor transcript paths and chat links in upstream prose are source-host references; do not invent them or read other workspaces to fill gaps.',
      'Cursor /loop, /goal, cloud hosting, /automate editor, built-in create-skill and Grok Bot routines are not implemented here. cursor-team-kit deslop/control-cli/control-ui, MCP connectors and service credentials are external dependencies. Stop the affected workflow at its unmet gate and name what is missing. Do not fabricate equivalent verification or approvals.',
      'Benny is a dormant source pack, not a registered automation. Its Cursor reviewed-editor creation and credential-isolation requirements remain unsatisfied by this extension.',
      `This session transcript is ${ctx.sessionManager.getSessionFile() ?? 'in memory'}. Workspace is ${ctx.cwd}.`,
    ].join('\n\n');
    if (state.enabled) event.systemPromptOptions.sections.pstack_mode = `References are relative to ${dirname(mode.path)}.\n\n${mode.body}`;
    else delete event.systemPromptOptions.sections.pstack_mode;
    if (state.todos.length) event.systemPromptOptions.sections.pstack_todos = JSON.stringify(state.todos);
    else delete event.systemPromptOptions.sections.pstack_todos;
  });

  pi.registerTool({
    name: 'pstack_mode', label: 'Poteto mode',
    description: 'Set sticky Poteto mode when the user requests it or opts out. Persists on the active session branch.',
    parameters: Type.Object({ enabled: Type.Boolean() }),
    async execute(_id, params, _signal, _update, ctx) {
      toggle(params.enabled, ctx);
      return result(`Poteto mode is ${state.enabled ? 'on' : 'off'}.`, state);
    },
  });
  pi.registerTool({
    name: 'TodoWrite', label: 'Pstack todos',
    description: 'Replace or merge the ordered todo list. Copy the selected playbook steps verbatim before task-specific steps. Keep skipped steps with a reason.',
    parameters: Type.Object({ todos: Type.Array(Todo), merge: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (new Set(params.todos.map((todo) => todo.id)).size !== params.todos.length) throw new Error('Todo IDs must be unique.');
      const todos = params.merge ? new Map(state.todos.map((todo) => [todo.id, todo])) : new Map<string, Static<typeof Todo>>();
      for (const todo of params.todos) todos.set(todo.id, todo);
      state = { ...state, todos: [...todos.values()] };
      persist(ctx);
      return result(JSON.stringify(state.todos), state.todos);
    },
  });
  pi.registerTool({
    name: 'AskQuestion', label: 'Ask question',
    description: 'Ask the user a preference or required approval. No UI means no answer. Never infer consent from cancellation.',
    parameters: Type.Object({ questions: Type.Array(Type.Object({
      id: Type.String(), prompt: Type.String(),
      options: Type.Optional(Type.Array(Type.Object({ id: Type.String(), label: Type.String() }))),
      allow_multiple: Type.Optional(Type.Boolean()),
    }), { minItems: 1, maxItems: 4 }) }),
    async execute(_id, params, signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error('AskQuestion requires Pi TUI or an RPC client supporting extension dialogs. Ask in the conversation and wait for a user reply.');
      const answers: { id: string; answers: string[]; cancelled: boolean }[] = [];
      for (const question of params.questions) {
        const selected: string[] = [];
        let cancelled = false;
        if (question.options?.length) {
          const choices = new Map(question.options.map((option) => [`${option.label} [${option.id}]`, option.id]));
          while (true) {
            const labels = [...choices.keys(), 'Enter a text answer'];
            if (question.allow_multiple) labels.push('Done selecting');
            const answer = await ctx.ui.select(question.prompt, labels, { signal });
            if (answer === undefined) { cancelled = true; break; }
            if (answer === 'Done selecting') break;
            if (answer === 'Enter a text answer') {
              const text = await ctx.ui.input(question.prompt, undefined, { signal });
              if (text === undefined) { cancelled = true; break; }
              selected.push(text);
            } else {
              const id = choices.get(answer);
              if (id !== undefined) { selected.push(id); choices.delete(answer); }
            }
            if (!question.allow_multiple) break;
          }
        } else {
          const answer = await ctx.ui.input(question.prompt, undefined, { signal });
          if (answer === undefined) cancelled = true;
          else selected.push(answer);
        }
        answers.push({ id: question.id, answers: selected, cancelled });
        if (cancelled) break;
      }
      return result(JSON.stringify(answers), answers);
    },
  });
  pi.registerTool({
    name: 'pstack_context', label: 'Pstack context',
    description: 'Return current Pi transcript location, active branch entries, tools, available models, and optional history scoped to the current workspace. Use file pointers for delegation.',
    parameters: Type.Object({ history: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, signal, _update, ctx) {
      const details = {
        cwd: ctx.cwd,
        sessionFile: ctx.sessionManager.getSessionFile(),
        entries: ctx.sessionManager.getBranch(),
        tools: pi.getAllTools().map((tool) => ({ name: tool.name, description: tool.description })),
        models: ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`),
        history: params.history ? await SessionManager.list(ctx.cwd, undefined, undefined, signal) : [],
      };
      const text = JSON.stringify(details);
      return result(text.length > 48000 ? `${text.slice(0, 48000)}\n[Truncated. Full current transcript: ${details.sessionFile ?? 'available in tool details'}]` : text, details);
    },
  });
  pi.registerCommand('pstack', {
    description: 'Show pstack status, source version, model rule, and host compatibility limits.',
    handler: async (_args, ctx) => {
      pi.sendMessage({ customType: 'pstack-status', display: true, details: state, content: [
        `pstack 0.15.5 for Pi 0.87.1. ${skills.size} skill aliases. Poteto mode ${state.enabled ? 'on' : 'off'}.`,
        `Model configuration: ${modelConfigPath()}`,
        `Compatibility report: ${join(root, 'docs/parity.md')}`,
        'Partial runtime parity. Cursor cloud agents, hosted automation editor, loops/goals, bot routines, external skills and credential isolation are not supplied.',
      ].join('\n') });
      showState(ctx);
    },
  });
  registerWorkers(pi);
}
