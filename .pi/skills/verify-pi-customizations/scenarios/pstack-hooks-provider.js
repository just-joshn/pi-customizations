// biome-ignore lint/correctness/noUndeclaredDependencies: Pi loads this fixture and provides @earendil-works/pi-ai at runtime
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const CAPTURE = process.env.PSTACK_HOOKS_CAPTURE;
const WRITE_PATH = process.env.PSTACK_HOOKS_WRITE_PATH;

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function lastText(context) {
  for (const message of context.messages.toReversed()) {
    if (message.role === 'user' || message.role === 'custom') {
      const text = textOf(message);
      if (text) return text;
    }
  }
  return '';
}

function clip(value, limit = 2000) {
  if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}…` : value;
  return value;
}

function sectionsOf(messages) {
  const sections = {};
  for (const message of messages) {
    if (message.role !== 'system' || !message.sections) continue;
    for (const [name, value] of Object.entries(message.sections)) sections[name] = clip(String(value));
  }
  return sections;
}

function capture(model, context, payload, headers, options) {
  if (!CAPTURE) return;
  try {
    const record = {
      at: new Date().toISOString(),
      provider: model.provider,
      model: model.id,
      api: model.api,
      optionKeys: Object.keys(options ?? {}).sort(),
      payload,
      headers,
      sections: sectionsOf(context.messages),
      lastText: clip(lastText(context), 400),
      texts: context.messages.map((message) => clip(textOf(message), 600)),
      roles: context.messages.map((message) => message.role),
      customTypes: context.messages.map((message) => message.customType).filter(Boolean),
      toolNames: (context.messages.find((message) => message.role === 'system')?.tools ?? []).map((tool) => tool.name),
    };
    fs.mkdirSync(path.dirname(CAPTURE), { recursive: true });
    fs.appendFileSync(CAPTURE, `${JSON.stringify(record)}\n`);
  } catch {
    // A capture failure must not change the session under test.
  }
}

function usage(cost = 0) {
  return { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: cost, output: cost, cacheRead: 0, cacheWrite: 0, total: cost } };
}

function assistant(model, content, reason) {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    content,
    stopReason: reason,
    usage: usage(),
  };
}

function tool(name, args) {
  return { name, arguments: args };
}

const todos = [
  { id: 'hk-1', content: 'Read the playbook', status: 'completed' },
  { id: 'hk-2', content: 'Write the receipt', status: 'in_progress' },
];

const goalObjective = 'Ship the queue';
let holdAfterTool = false;

const probes = [
  { pattern: /HK_TODOS/, call: () => tool('TodoWrite', { todos }) },
  {
    pattern: /HK_TASK_SUBAGENT_EXPLORE_BASH/,
    call: () => tool('task', { agent_type: 'explore', name: 'hk-explore-bash', description: 'policy probe', prompt: 'HK_CHILD_BASH', mode: 'sync' }),
  },
  {
    pattern: /HK_TASK_SUBAGENT_EXPLORE_WRITE/,
    call: () => tool('task', { agent_type: 'explore', name: 'hk-explore-write', description: 'policy probe', prompt: 'HK_CHILD_WRITE', mode: 'sync' }),
  },
  {
    pattern: /HK_TASK_SUBAGENT_GENERAL_WRITE/,
    call: () => tool('task', { agent_type: 'general-purpose', name: 'hk-general-write', description: 'policy probe', prompt: 'HK_CHILD_WRITE', mode: 'sync' }),
  },
  {
    pattern: /HK_TASK_SUBAGENT_WRITER_WRITE/,
    call: () => tool('task', { agent_type: 'hk-writer', name: 'hk-writer', description: 'policy probe', prompt: 'HK_CHILD_WRITE', mode: 'sync', model: 'pstack-hooks/scripted' }),
  },
  {
    pattern: /HK_TASK_SUBAGENT_LOCAL_ENV/,
    call: () => tool('task', { agent_type: 'general-purpose', name: 'hk-local-env', description: 'policy probe', prompt: 'HK_CHILD_READ_ENV', mode: 'sync' }),
  },
  {
    pattern: /HK_TASK_FAIL/,
    call: () => tool('Task', { prompt: 'HK_CHILD_FAIL', subagent_type: 'generalPurpose', model: 'pstack-hooks/scripted', name: 'hk-fail', description: 'failed usage probe', run_in_background: false }),
  },
  {
    pattern: /HK_TASK_SUBAGENT_COPILOT/,
    call: () => tool('task', { agent_type: 'general-purpose', name: 'hk-copilot-child', description: 'assistant wire probe', prompt: 'HK_CHILD_TEXT', mode: 'sync', model: 'github-copilot/hk-copilot' }),
  },
  {
    pattern: /HK_TASK_SUBAGENT_SYNC/,
    call: () => tool('task', { agent_type: 'general-purpose', name: 'hk-sync-headers', description: 'identity probe', prompt: 'HK_CHILD_TEXT', mode: 'sync' }),
  },
  { pattern: /HK_GOAL_ABORT/, call: () => ({ hold: true, call: tool('CreateGoal', { objective: goalObjective }) }) },
  { pattern: /HK_GOAL_CREATE/, call: () => tool('CreateGoal', { objective: goalObjective }) },
  { pattern: /Goal still active/, call: () => tool('UpdateGoal', { status: 'complete' }) },
  { pattern: /HK_GOAL_CLEAR_TRIGGER/, call: () => tool('TodoWrite', { todos: [] }) },
  { pattern: /HK_SHELL_START/, call: () => tool('BackgroundShell', { command: "printf 'HK_READY\\n'; sleep 120", title: 'hk-shell', notify_on_output: 'HK_READY' }) },
  { pattern: /HK_SHELL_TWO_WAKES/, call: () => tool('BackgroundShell', { command: "printf 'HK_READY\\n'; sleep 2; printf 'HK_READY\\n'; sleep 120", title: 'hk-two', notify_on_output: 'HK_READY' }) },
  // biome-ignore lint/security/noSecrets: BackgroundShellList is a tool name, not a credential
  { pattern: /HK_SHELL_LIST/, call: () => tool('BackgroundShellList', {}) },
  {
    pattern: /HK_TASK_BG_ABORT/,
    call: () => ({ hold: true, call: tool('Task', { prompt: 'HK_CHILD_HOLD:600', subagent_type: 'generalPurpose', model: 'pstack-hooks/scripted', name: 'hk-abort-child', description: 'held wake probe', run_in_background: true }) }),
  },
  {
    pattern: /HK_TASK_BG_LONG/,
    call: () => tool('Task', { prompt: 'HK_CHILD_HOLD:8000', subagent_type: 'generalPurpose', model: 'pstack-hooks/scripted', name: 'hk-long-child', description: 'shutdown probe', run_in_background: true }),
  },
  {
    pattern: /HK_TASK_LIST/,
    call: () => tool('TaskList', {}),
  },
  {
    pattern: /HK_SUBAGENT_BG/,
    call: () => tool('task', { agent_type: 'general-purpose', name: 'hk-bg', description: 'hook background', prompt: 'HK_CHILD_HOLD:2500', mode: 'background' }),
  },
  {
    pattern: /HK_SUBAGENT_SYNC/,
    call: () => tool('task', { agent_type: 'general-purpose', name: 'hk-sub', description: 'hook subagent', prompt: 'HK_CHILD_TEXT', mode: 'sync' }),
  },
  {
    pattern: /HK_TASK_BG/,
    call: () => tool('Task', { prompt: 'HK_CHILD_HOLD:1500', subagent_type: 'generalPurpose', model: 'pstack-hooks/scripted', name: 'hk-child', description: 'hook probe', run_in_background: true }),
  },
  {
    pattern: /HK_TASK_SYNC/,
    call: () => tool('Task', { prompt: 'HK_CHILD_TEXT', subagent_type: 'generalPurpose', model: 'pstack-hooks/scripted', name: 'hk-sync', description: 'hook probe' }),
  },
  {
    pattern: /HK_TASK_GENERAL_WRITE/,
    call: () => tool('Task', { prompt: 'HK_CHILD_WRITE', subagent_type: 'generalPurpose', model: 'pstack-hooks/scripted', name: 'hk-general', description: 'write gate probe' }),
  },
  {
    pattern: /HK_TASK_COPILOT/,
    call: () => tool('Task', { prompt: 'HK_CHILD_TEXT', subagent_type: 'generalPurpose', model: 'github-copilot/hk-copilot', name: 'hk-copilot', description: 'identity probe' }),
  },
  {
    pattern: /HK_TASK_EXPLORE_WRITE/,
    call: () => tool('Task', { prompt: 'HK_CHILD_WRITE', subagent_type: 'explore', model: 'pstack-hooks/scripted', name: 'hk-explore', description: 'hook probe' }),
  },
  {
    pattern: /HK_TASK_EXPLORE_BASH/,
    call: () => tool('Task', { prompt: 'HK_CHILD_BASH', subagent_type: 'explore', model: 'pstack-hooks/scripted', name: 'hk-explore-bash', description: 'hook probe' }),
  },
  {
    pattern: /HK_TASK_LOCAL_ENV/,
    call: () => tool('Task', { prompt: 'HK_CHILD_READ_ENV', subagent_type: 'generalPurpose', model: 'pstack-hooks/scripted', name: 'hk-local', description: 'hook probe' }),
  },
  { pattern: /HK_READ_ENV/, call: () => tool('read', { path: '.env' }) },
  { pattern: /HK_WORKFLOW_RUN/, call: () => tool('run_dynamic_workflow', { name: 'hk-workflow' }) },
  { pattern: /HK_ROUTINE/, call: () => tool('RoutinePrepare', { name: 'hk-routine', prompt: 'hk routine prompt', fields: ['action'], port: 0 }) },
  { pattern: /HK_WRITE/, call: () => tool('write', { path: WRITE_PATH ?? 'hk-write.txt', content: 'hook probe\n' }) },
  { pattern: /HK_CHILD_WRITE/, call: () => tool('write', { path: WRITE_PATH ?? 'hk-child-write.txt', content: 'child write\n' }) },
  { pattern: /HK_CHILD_BASH/, call: () => tool('bash', { command: 'echo HK_CHILD_BASH' }) },
  { pattern: /HK_CHILD_GREP/, call: () => tool('grep', { pattern: 'HK', path: '.' }) },
  { pattern: /HK_CHILD_READ_ENV/, call: () => tool('read', { path: '.env' }) },
];

function pick(model, context, options) {
  const payload = { model: model.id, messages: context.messages, stream: true };
  return Promise.resolve(options?.onPayload?.(payload, model)).then((next) => {
    const transformed = next === undefined ? payload : next;
    const base = { ...(options?.headers ?? {}) };
    const resolveHeaders = typeof options?.transformHeaders === 'function' ? options.transformHeaders(base) : Promise.resolve(base);
    return Promise.resolve(resolveHeaders).then((resolved) => ({ transformed, headers: resolved }));
  });
}

function respond(_model, context, _options) {
  const last = context.messages.at(-1);
  const text = lastText(context);
  if (last?.role === 'toolResult') {
    if (last.toolName === 'RoutinePrepare') {
      const content = textOf(last);
      const routineId = content.match(/"routineId":"([0-9a-f-]{36})"/)?.[1];
      const revision = content.match(/"revision":"([a-f0-9]{64})"/)?.[1];
      if (routineId && revision) return { call: tool('RoutineEnable', { routineId, revision }) };
    }
    if (holdAfterTool) {
      holdAfterTool = false;
      return { text: `hk held tool reply ${Date.now()}`, delay: 3000 };
    }
    return { text: `hk tool reply ${Date.now()}` };
  }
  if (text.startsWith('<current_datetime>') && text.includes('HK_SIDEKICK_HOLD')) return { call: tool('send_inbox', { message: 'HK sidekick inbox' }), delay: 5000 };
  if (text.startsWith('<current_datetime>') && text.includes('HK_SIDEKICK')) return { call: tool('send_inbox', { message: 'HK sidekick inbox' }) };
  if (text.startsWith('<current_datetime>') && text.includes('The session context changed')) return { call: tool('send_inbox', { message: 'HK compact sidekick' }) };
  for (const probe of probes) {
    if (!probe.pattern.test(text)) continue;
    const result = probe.call();
    if (result.hold) {
      holdAfterTool = true;
      return { call: result.call };
    }
    return { call: result };
  }
  if (/HK_CHILD_FAIL/.test(text)) return { fail: 'HK_CHILD_FAIL' };
  const hold = text.match(/HK_CHILD_HOLD:(\d+)/);
  if (hold) return { text: `hk child reply ${Date.now()}`, delay: Number(hold[1]) };
  return { text: `hk scripted reply ${Date.now()}` };
}

function start(model, context, options, scripted) {
  const stream = createAssistantMessageEventStream();
  pick(model, context, options)
    .then(({ transformed, headers }) => {
      capture(model, context, transformed, headers, options);
      if (scripted.fail) {
        const message = assistant(model, [{ type: 'text', text: 'failed by fixture' }], 'error');
        message.errorMessage = scripted.fail;
        stream.push({ type: 'error', reason: 'error', error: message });
        stream.end(message);
        return;
      }
      if (scripted.call && !scripted.delay) {
        stream.push({ type: 'done', reason: 'toolUse', message: assistant(model, [{ type: 'toolCall', id: `hk-${Math.random().toString(36).slice(2, 10)}`, ...scripted.call }], 'toolUse') });
        stream.end();
        return;
      }
      if (scripted.call && scripted.delay) {
        const call = scripted.call;
        const withCall = () => {
          stream.push({ type: 'done', reason: 'toolUse', message: assistant(model, [{ type: 'toolCall', id: `hk-${Math.random().toString(36).slice(2, 10)}`, ...call }], 'toolUse') });
          stream.end();
        };
        const timer = setTimeout(withCall, scripted.delay);
        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const aborted = assistant(model, [], 'aborted');
            stream.push({ type: 'error', reason: 'aborted', error: aborted });
            stream.end(aborted);
          },
          { once: true },
        );
        return;
      }
      const message = assistant(model, [{ type: 'text', text: scripted.text }], 'stop');
      const finish = () => {
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      };
      if (scripted.delay) {
        const timer = setTimeout(finish, scripted.delay);
        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const aborted = { ...message, stopReason: 'aborted' };
            stream.push({ type: 'error', reason: 'aborted', error: aborted });
            stream.end(aborted);
          },
          { once: true },
        );
      } else finish();
    })
    .catch((error) => {
      const message = assistant(model, [{ type: 'text', text: String(error) }], 'error');
      message.errorMessage = String(error);
      stream.push({ type: 'error', reason: 'error', error: message });
      stream.end(message);
    });
  return stream;
}

function register(pi, provider, modelId, api, envKey) {
  if (envKey && process.env[envKey] !== '1') return;
  pi.registerProvider(provider, {
    api,
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: modelId, name: `Hooks fixture ${modelId}`, reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model, context, options) => start(model, context, options, respond(model, context, options)),
  });
}

export default function pstackHooksProvider(pi) {
  register(pi, 'pstack-hooks', 'scripted', 'openai-completions');
  register(pi, 'github-copilot', 'hk-copilot', 'openai-completions', 'PSTACK_HOOKS_COPILOT');
  register(pi, 'pstack-hooks-anthropic', 'scripted-claude', 'anthropic-messages', 'PSTACK_HOOKS_ANTHROPIC');
  if (process.env.PSTACK_HOOKS_WORKFLOW === '1') {
    pi.on('session_start', () => {
      pi.events.emit('reference-assistant:register-workflow', {
        name: 'hk-workflow',
        description: 'Hook probe workflow',
        run: async (workflow) => {
          workflow.log('hk workflow log');
          workflow.phase('hk-phase');
          await new Promise((resolve) => setTimeout(resolve, 6000));
          return { ok: true, marker: 'hk-workflow-result' };
        },
      });
    });
  }
}
