import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// biome-ignore lint/correctness/noUndeclaredDependencies: Pi loads this fixture and provides @earendil-works/pi-ai at runtime
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PROMPT = 'reply with the fixture text';

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function lastUserText(context) {
  return textOf(context.messages.findLast((message) => message.role === 'user'));
}

function systemText(context) {
  const direct = typeof context.systemPrompt === 'string' ? context.systemPrompt : '';
  const parts = context.messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => [textOf(message), ...Object.values(message.sections ?? {})])
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)));
  return [direct, ...parts].filter(Boolean).join('\n');
}

function lastId(context, toolNames, pattern) {
  const names = Array.isArray(toolNames) ? toolNames : [toolNames];
  for (const message of context.messages.toReversed()) {
    if (message.role !== 'toolResult' || !names.includes(message.toolName)) continue;
    const match = textOf(message).match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function tool(name, args) {
  return { name, arguments: args };
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
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function streamOf(model, content, reason, delayMs = 0, signal) {
  const message = assistant(model, content, reason);
  const stream = createAssistantMessageEventStream();
  const finish = () => {
    stream.push({ type: 'done', reason, message });
    stream.end(message);
  };
  if (delayMs > 0 && signal) {
    const timer = setTimeout(finish, delayMs);
    const stop = () => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  } else if (delayMs > 0) setTimeout(finish, delayMs);
  else finish();
  return stream;
}

function record(model, context, options) {
  const target = process.env.PSTACK_ENV_PROVIDER_LOG;
  if (!target) return;
  const system = systemText(context);
  const entry = {
    at: new Date().toISOString(),
    model: `${model.provider}/${model.id}`,
    apiKey: options?.apiKey ?? model.apiKey ?? null,
    text: lastUserText(context).slice(0, 120),
    hasPstackHost: system.includes('pstack pi host contract'),
    hostSkills: system.split('\n').find((line) => line.includes('Host skills live at')) ?? '',
  };
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(entry)}\n`);
}

const probes = [
  { pattern: /^ENV_BG_AGENT$/, call: () => tool('task', { agent_type: 'general-purpose', name: 'pt-agent', description: 'verification probe', prompt: 'HOLD:9000', mode: 'background' }) },
  { pattern: /^ENV_SYNC_HOLD$/, call: () => tool('task', { agent_type: 'general-purpose', name: 'pt-sync', description: 'verification probe', prompt: 'HOLD:8000', mode: 'sync' }) },
  { pattern: /^ENV_SHELL$/, call: () => tool('BackgroundShell', { command: 'sleep 60', title: 'pt-shell' }) },
  // biome-ignore lint/security/noSecrets: deterministic tool name fixture, not a credential
  { pattern: /^ENV_SHELL_STOP$/, call: (_match, context) => tool('BackgroundShellStop', { id: lastId(context, 'BackgroundShell', new RegExp(`"id":"(${UUID})"`)) }) },
  { pattern: /^ENV_TASK_SYNC$/, call: () => tool('Task', { prompt: PROMPT, subagent_type: 'generalPurpose', readonly: true, run_in_background: false }) },
  { pattern: /^ENV_TASK_BG$/, call: () => tool('Task', { prompt: 'HOLD:90000', subagent_type: 'generalPurpose', readonly: true, run_in_background: true }) },
  { pattern: /^ENV_EXEC_MODEL$/, call: () => tool('execution_subagent', { description: 'verification probe', prompt: PROMPT }) },
  { pattern: /^ENV_EXEC_TURNS$/, call: () => tool('execution_subagent', { description: 'verification probe', prompt: 'CHILD_LOOP' }) },
  { pattern: /^ENV_SEARCH_MODEL$/, call: () => tool('search_subagent', { description: 'verification probe', prompt: PROMPT }) },
  { pattern: /^ENV_SEARCH_TURNS$/, call: () => tool('search_subagent', { description: 'verification probe', prompt: 'CHILD_LOOP' }) },
  { pattern: /^ENV_CLOUD_TASK$/, call: () => tool('Task', { prompt: PROMPT, environment: 'cloud', run_in_background: true }) },
  { pattern: /^ENV_TIMER$/, call: () => tool('SubscribeTimer', { name: 'pt-timer', prompt: 'PT timer prompt', delaySeconds: 3600 }) },
  { pattern: /^ENV_TIMER_LIST$/, call: () => tool('ListSubscriptions', {}) },
  { pattern: /^ENV_UNSUB_LAST$/, call: (_match, context) => tool('Unsubscribe', { subscriptionId: lastId(context, ['SubscribeTimer', 'SubscribeOriginCI'], new RegExp(`"subscriptionId":"(${UUID})"`)) }) },
  { pattern: /^ENV_ORIGIN$/, call: () => tool('SubscribeOriginCI', { repo: 'acme/widgets', pr: 7 }) },
  { pattern: /^ENV_BOARD$/, call: () => tool('context_board', { action: 'write', key: 'pt-key', value: 'pt-value' }) },
  { pattern: /^CFG_ROUTINE$/, call: () => tool('RoutinePrepare', { name: 'pt-routine', prompt: 'PT routine prompt', fields: ['action'], port: 0 }) },
  { pattern: /^CFG_ROUTINE_DISABLE$/, call: (_match, context) => tool('RoutineDisable', { routineId: lastId(context, 'RoutinePrepare', new RegExp(`"routineId":"(${UUID})"`)) }) },
  {
    pattern: /^ENV_ROUTINE_ENABLE$/,
    call: (_match, context) =>
      tool('RoutineEnable', {
        routineId: lastId(context, 'RoutinePrepare', new RegExp(`"routineId":"(${UUID})"`)),
        revision: lastId(context, 'RoutinePrepare', /"revision":"([a-f0-9]{64})"/),
      }),
  },
  { pattern: /^ENV_PING$/, call: () => tool('context_board', { action: 'read' }) },
  { pattern: /^CFG12_TASK$/, call: () => tool('Task', { prompt: 'HOLD:20000', subagent_type: 'generalPurpose', readonly: true, run_in_background: true }) },
  { pattern: /^ENV_WORKFLOW_RUN$/, call: () => tool('run_dynamic_workflow', { name: 'pt-probe' }) },
  { pattern: /^ENV_LIST_REPO$/, call: () => tool('TaskList', { repository: true }) },
];

export default function pstackEnvProvider(pi) {
  pi.registerProvider('pstack-verify-env', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [
      { id: 'scripted-env', name: 'Scripted env fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: 'scripted-alt', name: 'Scripted env alternate', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ],
    streamSimple: (model, context, options) => {
      record(model, context, options);
      const last = context.messages.at(-1);
      if (last?.role !== 'user') {
        const looping = context.messages.some((message) => message.role === 'user' && textOf(message).includes('CHILD_LOOP'));
        if (looping && last?.role === 'toolResult') return streamOf(model, [{ type: 'toolCall', id: 'child-loop', ...tool('bash', { command: 'echo loop' }) }], 'toolUse');
        return streamOf(model, [{ type: 'text', text: 'scripted fixture reply' }], 'stop');
      }
      const text = lastUserText(context);
      if (text.includes('CHILD_LOOP')) return streamOf(model, [{ type: 'toolCall', id: 'child-loop', ...tool('bash', { command: 'echo loop' }) }], 'toolUse');
      if (text.startsWith('<current_datetime>') && text.includes('ENV12_TRIGGER')) return streamOf(model, [{ type: 'toolCall', id: 'sidekick-inbox', ...tool('send_inbox', { message: 'PT sidekick inbox message' }) }], 'toolUse');
      const hold = text.match(/HOLD:(\d+)/);
      if (hold) return streamOf(model, [{ type: 'text', text: 'scripted fixture reply' }], 'stop', Number(hold[1]), options?.signal);
      for (const probe of probes) {
        const match = text.match(probe.pattern);
        if (match) return streamOf(model, [{ type: 'toolCall', id: `probe-${probe.pattern.source.slice(0, 20)}`, ...probe.call(match, context) }], 'toolUse');
      }
      return streamOf(model, [{ type: 'text', text: 'scripted fixture reply' }], 'stop');
    },
  });
  pi.on('session_start', () => {
    pi.events.emit('reference-assistant:register-workflow', {
      name: 'pt-probe',
      description: 'Verification probe workflow',
      run: async (context) => {
        context.phase('pt-phase');
        return { ok: true, marker: 'pt-workflow-result' };
      },
    });
  });
}
