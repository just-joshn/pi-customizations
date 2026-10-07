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

function lastUserId(context, toolName, pattern) {
  for (const message of context.messages.toReversed()) {
    if (message.role !== 'toolResult' || message.toolName !== toolName) continue;
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

function streamOf(model, content, reason, delayMs = 0) {
  const message = assistant(model, content, reason);
  const stream = createAssistantMessageEventStream();
  const finish = () => {
    stream.push({ type: 'done', reason, message });
    stream.end(message);
  };
  if (delayMs > 0) setTimeout(finish, delayMs);
  else finish();
  return stream;
}

const questions = (id, count) =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `${id}-q${index + 1}`,
    prompt: `Probe question ${index + 1}?`,
    options: [
      { id: `opt${index + 1}a`, label: `Option ${index + 1}A` },
      { id: `opt${index + 1}b`, label: `Option ${index + 1}B` },
    ],
  }));

const probes = [
  { pattern: /^PT26_ANSWER$/, call: () => tool('AskQuestion', { questions: questions('pt26', 4) }) },
  { pattern: /^PT26_CANCEL$/, call: () => tool('AskQuestion', { questions: questions('pt26c', 2) }) },
  { pattern: /^PT28_SYNC$/, call: () => tool('task', { agent_type: 'general-purpose', name: 'pt-sync', description: 'verification probe', prompt: PROMPT, mode: 'sync' }) },
  { pattern: /^PT28_BG_HOLD$/, call: () => tool('task', { agent_type: 'general-purpose', name: 'pt-bg', description: 'verification probe', prompt: 'HOLD:8000', mode: 'background' }) },
  { pattern: /^PT29_READ_LAST$/, call: (_match, context) => tool('read_agent', { agent_id: lastUserId(context, 'task', new RegExp(`agent_id: (${UUID})`)), wait: true, timeout: 30 }) },
  { pattern: /^PT30_WRITE_LAST$/, call: (_match, context) => tool('write_agent', { agent_id: lastUserId(context, 'task', new RegExp(`agent_id: (${UUID})`)), message: 'PT follow-up message' }) },
  { pattern: /^PT31_LIST$/, call: () => tool('list_agents', {}) },
  { pattern: /^PT31_LIST_ALL$/, call: () => tool('list_agents', { scope: 'all' }) },
  { pattern: /^PT13_SYNC$/, call: () => tool('Task', { prompt: PROMPT, subagent_type: 'generalPurpose', readonly: true, run_in_background: false }) },
  { pattern: /^PT13_BG_HOLD$/, call: () => tool('Task', { prompt: 'HOLD:9000', subagent_type: 'generalPurpose', readonly: true, run_in_background: true }) },
  { pattern: /^PT13_CLOUD$/, call: () => tool('Task', { prompt: PROMPT, environment: 'cloud', run_in_background: false }) },
  { pattern: /^PT14_OUTPUT_LAST$/, call: (_match, context) => tool('TaskOutput', { task_id: lastUserId(context, 'Task', new RegExp(`"task_id":"(${UUID})"`)), block: true }) },
  { pattern: /^PT15_STOP_LAST$/, call: (_match, context) => tool('TaskStop', { task_id: lastUserId(context, 'Task', new RegExp(`"task_id":"(${UUID})"`)) }) },
  { pattern: /^PT16_MESSAGE_LAST$/, call: (_match, context) => tool('TaskMessage', { task_id: lastUserId(context, 'Task', new RegExp(`"task_id":"(${UUID})"`)), message: 'PT queued message', mode: 'steer' }) },
  { pattern: /^PT17_LIST$/, call: () => tool('TaskList', {}) },
  { pattern: /^PT17_LIST_REPO$/, call: () => tool('TaskList', { repository: true }) },
  { pattern: /^PT18_ATTACH_LAST$/, call: (_match, context) => tool('TaskAttach', { task_id: lastUserId(context, 'Task', new RegExp(`"task_id":"(${UUID})"`)) }) },
  { pattern: /^PT32_WRITE$/, call: () => tool('context_board', { action: 'write', key: 'pt-key', value: 'pt-value' }) },
  { pattern: /^PT32_READ$/, call: () => tool('context_board', { action: 'read' }) },
  { pattern: /^PT32_DELETE$/, call: () => tool('context_board', { action: 'delete', key: 'pt-key' }) },
  { pattern: /^PT34_EXEC$/, call: () => tool('execution_subagent', { description: 'verification probe', prompt: PROMPT }) },
  { pattern: /^PT35_SEARCH$/, call: () => tool('search_subagent', { description: 'verification probe', prompt: PROMPT }) },
  { pattern: /^PT36_RUN$/, call: () => tool('run_dynamic_workflow', { name: 'pt-probe' }) },
  { pattern: /^PT37_LIST$/, call: () => tool('dynamic_workflows_manage', { action: 'list' }) },
  { pattern: /^PT37_PAUSE:([a-z0-9-]+)$/, call: (match) => tool('dynamic_workflows_manage', { action: 'pause', run_id: match[1] }) },
  { pattern: /^PT37_RESUME:([a-z0-9-]+)$/, call: (match) => tool('dynamic_workflows_manage', { action: 'resume', run_id: match[1] }) },
  { pattern: /^PT37_CANCEL:([a-z0-9-]+)$/, call: (match) => tool('dynamic_workflows_manage', { action: 'cancel', run_id: match[1] }) },
  { pattern: /^PT38_READ:([a-z0-9-]+)$/, call: (match) => tool('read_workflow_run', { run_id: match[1] }) },
  { pattern: /^PT6_SUBSCRIBE$/, call: () => tool('SubscribeTimer', { name: 'pt-timer', prompt: 'PT timer prompt', delaySeconds: 3600 }) },
  { pattern: /^PT7_LIST$/, call: () => tool('ListSubscriptions', {}) },
  { pattern: /^PT8_UNSUB_LAST$/, call: (_match, context) => tool('Unsubscribe', { subscriptionId: lastUserId(context, 'SubscribeTimer', new RegExp(`"subscriptionId":"(${UUID})"`)) }) },
  { pattern: /^PT8_UNSUB_CI_LAST$/, call: (_match, context) => tool('Unsubscribe', { subscriptionId: lastUserId(context, 'SubscribeGithubCI', new RegExp(`"subscriptionId":"(${UUID})"`)) }) },
  { pattern: /^PT3_RESTART$/, call: () => tool('RestartSubscriptions', {}) },
  { pattern: /^PT5_ORIGIN$/, call: () => tool('SubscribeOriginCI', { repo: 'acme/widgets', pr: 7 }) },
  { pattern: /^PT4_GITHUB$/, call: () => tool('SubscribeGithubCI', { repo: 'acme/widgets', pr: 7, pollSeconds: 1, name: 'pt-ci-github' }) },
  { pattern: /^PT9_PREPARE$/, call: () => tool('RoutinePrepare', { name: 'pt-routine', prompt: 'PT routine prompt', fields: ['action'], port: 0 }) },
  { pattern: /^PT10_INSPECT_LAST$/, call: (_match, context) => tool('RoutineInspect', { routineId: lastUserId(context, 'RoutinePrepare', new RegExp(`"routineId":"(${UUID})"`)) }) },
  {
    pattern: /^PT11_ENABLE_LAST$/,
    call: (_match, context) => tool('RoutineEnable', { routineId: lastUserId(context, 'RoutinePrepare', new RegExp(`"routineId":"(${UUID})"`)), revision: lastUserId(context, 'RoutinePrepare', /"revision":"([a-f0-9]{64})"/) }),
  },
  { pattern: /^PT12_DISABLE_LAST$/, call: (_match, context) => tool('RoutineDisable', { routineId: lastUserId(context, 'RoutinePrepare', new RegExp(`"routineId":"(${UUID})"`)) }) },
  {
    pattern: new RegExp(`^PT11_DECLINE:(${UUID}):([a-f0-9]{64})$`),
    call: (match) => tool('RoutineEnable', { routineId: match[1], revision: match[2] }),
  },
];

function sidekickAction(text) {
  if (!text.startsWith('<current_datetime>') || !text.includes('PT33_INBOX_SIDEKICK')) return undefined;
  return tool('send_inbox', { message: 'PT inbox message' });
}

export default function pstackToolsProvider(pi) {
  pi.registerProvider('pstack-verify', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'scripted', name: 'Scripted fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model, context) => {
      const last = context.messages.at(-1);
      if (last?.role !== 'user') return streamOf(model, [{ type: 'text', text: 'scripted fixture reply' }], 'stop');
      const text = lastUserText(context);
      for (const probe of probes) {
        const match = text.match(probe.pattern);
        if (match) return streamOf(model, [{ type: 'toolCall', id: `probe-${probe.pattern.source.slice(0, 24)}`, ...probe.call(match, context) }], 'toolUse');
      }
      const sidekick = sidekickAction(text);
      if (sidekick) return streamOf(model, [{ type: 'toolCall', id: 'probe-sidekick-inbox', ...sidekick }], 'toolUse');
      const hold = text.match(/HOLD:(\d+)/);
      if (hold) return streamOf(model, [{ type: 'text', text: 'scripted fixture reply' }], 'stop', Number(hold[1]));
      return streamOf(model, [{ type: 'text', text: 'scripted fixture reply' }], 'stop');
    },
  });
  pi.on('session_start', () => {
    pi.events.emit('reference-assistant:register-workflow', {
      name: 'pt-probe',
      description: 'Verification probe workflow',
      run: async (context) => {
        context.log('pt workflow log line');
        context.phase('pt-phase');
        if (context.resumed) return { ok: true, resumed: true, marker: 'pt-workflow-result' };
        context.pause('pt-checkpoint');
      },
    });
  });
}
