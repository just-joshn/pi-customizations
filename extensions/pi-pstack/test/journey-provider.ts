import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type AssistantMessage, type Context, createAssistantMessageEventStream, type Model, type ToolCall } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const BG_SHELL_LIST = 'Background' + 'ShellList';
const BG_SHELL_STOP = 'Background' + 'ShellStop';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const progressFixture = process.env.PSTACK_PROGRESS_FIXTURE ?? join(packageRoot, 'test', 'fixtures', 'task-progress-sentinel.txt');

type CallArguments = ToolCall['arguments'];
type PlannedCall = { name: string; arguments: CallArguments };

const toolCalls: Record<string, PlannedCall[]> = {
  'JOURNEY:todowrite': [
    {
      name: 'TodoWrite',
      arguments: {
        todos: [
          { id: 'one', content: 'Read the playbook', status: 'completed' },
          { id: 'two', content: 'Run the journey', status: 'in_progress' },
          { id: 'three', content: 'Report findings', status: 'pending' },
        ],
      },
    },
  ],
  'JOURNEY:todomerge': [{ name: 'TodoWrite', arguments: { todos: [{ id: 'three', content: 'Report findings', status: 'completed' }], merge: true } }],
  'JOURNEY:modeon': [{ name: 'pstack_mode', arguments: { enabled: true } }],
  'JOURNEY:modeoff': [{ name: 'pstack_mode', arguments: { enabled: false } }],
  'JOURNEY:context': [{ name: 'pstack_context', arguments: {} }],
  'JOURNEY:history': [{ name: 'pstack_context', arguments: { history: true } }],
  'JOURNEY:cloud': [{ name: 'Task', arguments: { prompt: 'cloud work', environment: 'cloud' } }],
  'JOURNEY:badmodel': [{ name: 'Task', arguments: { prompt: 'modelled work', model: 'nowhere/missing', run_in_background: false } }],
  'JOURNEY:question': [
    {
      name: 'AskQuestion',
      arguments: {
        questions: [
          {
            id: 'approval',
            prompt: 'Approve the journey?',
            options: [
              { id: 'approve', label: 'Approve' },
              { id: 'decline', label: 'Decline' },
            ],
          },
        ],
      },
    },
  ],
  'JOURNEY:task': [{ name: 'Task', arguments: { prompt: 'Report the word delegate-ok and nothing else.', subagent_type: 'generalPurpose', run_in_background: false } }],
  'JOURNEY:progress': [{ name: 'Task', arguments: { prompt: 'JOURNEY:progress-child', subagent_type: 'generalPurpose', run_in_background: false } }],
  'JOURNEY:agent': [{ name: 'Agent', arguments: { description: 'agent probe', prompt: 'Report the word agent-ok and nothing else.', run_in_background: false } }],
  'JOURNEY:agentslow': [{ name: 'Agent', arguments: { description: 'slow probe', prompt: 'JOURNEY:slowchild', run_in_background: false } }],
  'JOURNEY:agentpair': [
    { name: 'Agent', arguments: { description: 'pair one', prompt: 'JOURNEY:slowchild', subagent_type: 'Explore', run_in_background: false } },
    { name: 'Agent', arguments: { description: 'pair two', prompt: 'JOURNEY:slowchild', run_in_background: false } },
  ],
  'JOURNEY:agenthooked': [{ name: 'Agent', arguments: { description: 'hooked probe', prompt: 'Report hooked.', isolation: 'worktree', run_in_background: false } }],
  'JOURNEY:agentturnlimit': [{ name: 'Agent', arguments: { description: 'bounded native probe', prompt: 'JOURNEY:progress-child', subagent_type: 'bounded-turn-probe', run_in_background: false } }],
  'JOURNEY:append-parent': [{ name: 'Task', arguments: { description: 'append parent', prompt: 'JOURNEY:append-child', subagent_type: 'generalPurpose', run_in_background: false } }],
  'JOURNEY:append-child': [{ name: 'Task', arguments: { prompt: 'JOURNEY:append-grandchild', subagent_type: 'generalPurpose', run_in_background: false } }],
  'JOURNEY:agentjsonnested': [{ name: 'Agent', arguments: { description: 'JSON parent', prompt: 'JOURNEY:agentjsonnested-child', subagent_type: 'json-parent', run_in_background: false } }],
  'JOURNEY:agentjsonnested-child': [{ name: 'Agent', arguments: { description: 'JSON leaf', prompt: 'JOURNEY:agentjsonnested-leaf', subagent_type: 'json-leaf', run_in_background: false } }],
  'JOURNEY:legacydepth': [{ name: 'Agent', arguments: { description: 'Legacy depth parent', prompt: 'JOURNEY:legacydepth-child', run_in_background: false } }],
  'JOURNEY:legacydepth-child': [{ name: 'Task', arguments: { prompt: 'JOURNEY:legacydepth-leaf', subagent_type: 'generalPurpose', run_in_background: false } }],
  'JOURNEY:agentrestored': [{ name: 'Agent', arguments: { description: 'Restored offer', prompt: 'JOURNEY:restored-offer-child', run_in_background: false } }],
  'JOURNEY:agentsimple': [{ name: 'Agent', arguments: { description: 'Must not delegate', prompt: 'SIMPLE_MUST_NOT_RUN_CHILD', subagent_type: 'general-purpose', run_in_background: false } }],
  'JOURNEY:agentjson': [{ name: 'Agent', arguments: { description: 'JSON definition probe', prompt: 'Report JSON definition.', subagent_type: 'probe-worker', run_in_background: false } }],
  'JOURNEY:agentremote': [{ name: 'Agent', arguments: { description: 'remote fallback probe', prompt: 'Report native fallback.', isolation: 'remote', run_in_background: false } }],
  'JOURNEY:agentunknown': [{ name: 'Agent', arguments: { description: 'unknown type', prompt: 'never runs', subagent_type: 'not-a-type' } }],
  'JOURNEY:readonly': [{ name: 'Task', arguments: { prompt: 'readonly child turn', readonly: true, run_in_background: false } }],
  'JOURNEY:badcwd': [{ name: 'Task', arguments: { prompt: 'cwd child turn', cwd: 'no/such/directory', run_in_background: false } }],
  'JOURNEY:localenv': [{ name: 'Task', arguments: { prompt: 'local child turn', environment: 'local', run_in_background: false } }],
  'JOURNEY:subagent': [{ name: 'Task', arguments: { prompt: 'Report the word delegate-ok and nothing else.', subagent_type: 'not-a-persona' } }],
  'JOURNEY:shellexit': [{ name: 'BackgroundShell', arguments: { command: "perl -MPOSIX -e 'POSIX::setsid(); sleep 300' & sleep 0.3", title: 'Escaping shell' } }],
  'JOURNEY:shellinvalid': [
    { name: 'BackgroundShell', arguments: { command: 'echo hi', title: 'Bad pattern', notify_on_output: '(' } },
    { name: 'BackgroundShell', arguments: { command: 'echo hi', title: '   ' } },
  ],
  'JOURNEY:shellunknown': [{ name: BG_SHELL_STOP, arguments: { id: 'not-a-shell' } }],
  'JOURNEY:todomany': [
    {
      name: 'TodoWrite',
      arguments: {
        todos: Array.from({ length: 12 }, (_value, index) => ({
          id: `step-${index + 1}`,
          content: `Step ${index + 1} of the long journey with a descriptive title`,
          status: index < 2 ? 'completed' : index === 6 ? 'in_progress' : 'pending',
        })),
      },
    },
  ],
  'JOURNEY:todocancel': [{ name: 'TodoWrite', arguments: { todos: [{ id: 'gone', content: 'Abandoned step', status: 'cancelled' }] } }],
  'JOURNEY:tododup': [
    {
      name: 'TodoWrite',
      arguments: {
        todos: [
          { id: 'same', content: 'First', status: 'pending' },
          { id: 'same', content: 'Second', status: 'pending' },
        ],
      },
    },
  ],
  'JOURNEY:slowchild': [{ name: 'bash', arguments: { command: 'sleep 3' } }],
  'JOURNEY:qmulti': [
    {
      name: 'AskQuestion',
      arguments: {
        questions: [
          {
            id: 'toppings',
            prompt: 'Pick journey toppings',
            allow_multiple: true,
            options: [
              { id: 'basil', label: 'Basil' },
              { id: 'oregano', label: 'Oregano' },
              { id: 'thyme', label: 'Thyme' },
            ],
          },
        ],
      },
    },
  ],
  'JOURNEY:qfree': [
    {
      name: 'AskQuestion',
      arguments: {
        questions: [
          {
            id: 'approval',
            prompt: 'Approve the free text journey?',
            options: [
              { id: 'approve', label: 'Approve' },
              { id: 'decline', label: 'Decline' },
            ],
          },
        ],
      },
    },
  ],
  'JOURNEY:qtext': [{ name: 'AskQuestion', arguments: { questions: [{ id: 'release', prompt: 'Name the journey release' }] } }],
  'JOURNEY:qdup': [
    {
      name: 'AskQuestion',
      arguments: {
        questions: [
          { id: 'same', prompt: 'First question' },
          { id: 'same', prompt: 'Second question' },
        ],
      },
    },
  ],
  'JOURNEY:qtoo': [
    {
      name: 'AskQuestion',
      arguments: {
        questions: Array.from({ length: 5 }, (_value, index) => ({ id: `q-${index + 1}`, prompt: `Question ${index + 1}` })),
      },
    },
  ],
};

function progressChildCalls(context: Context): PlannedCall[] {
  const last = context.messages.at(-1);
  if (last?.role === 'toolResult' && last.toolName === 'bash') return [{ name: 'read', arguments: { path: progressFixture } }];
  if (last?.role === 'user') return [{ name: 'bash', arguments: { command: 'sleep 0.4; printf PSTACK_CHILD_SHELL_OUTPUT_SENTINEL' } }];
  return [];
}

function escapingShellCalls(context: Context) {
  const started = context.messages.filter((message) => message.role === 'toolResult' && message.toolName === 'BackgroundShell').at(-1);
  const id = started === undefined ? undefined : JSON.stringify(started).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  return id ? [{ name: BG_SHELL_STOP, arguments: { id } }] : [];
}

function agentStopCalls(context: Context): PlannedCall[] {
  const results = toolResults(context);
  const started = results.find((message) => message.toolName === 'Agent');
  if (!started) return [{ name: 'Agent', arguments: { description: 'stop notification probe', prompt: 'JOURNEY:agentstop-child' } }];
  const id = taskIdOf(started);
  if (id && !results.some((message) => message.toolName === 'TaskStop')) return [{ name: 'TaskStop', arguments: { task_id: id } }];
  return [];
}

function dispatch(requested: string, context: Context): { calls: PlannedCall[] | undefined; sequenced: boolean } {
  if (requested === 'JOURNEY:agentstop') return { calls: agentStopCalls(context), sequenced: true };
  if (requested === 'JOURNEY:progress-child') return { calls: progressChildCalls(context), sequenced: true };
  if (requested === 'JOURNEY:tasklist') return { calls: backgroundTaskCalls(context), sequenced: true };
  if (requested === 'JOURNEY:taskresume') return { calls: taskResumeCalls(context), sequenced: true };
  if (requested === 'JOURNEY:taskpolicy') return { calls: taskPolicyCalls(context), sequenced: true };
  if (requested === 'JOURNEY:tasksteer') return { calls: taskSteerCalls(context), sequenced: true };
  if (requested === 'JOURNEY:tasklifecycle') return { calls: taskLifecycleCalls(context), sequenced: true };
  if (requested === 'JOURNEY:personas') return { calls: personaCalls(), sequenced: false };
  if (requested === 'JOURNEY:shell') return { calls: shellCalls(context), sequenced: true };
  if (requested === 'JOURNEY:shellexitstop') return { calls: escapingShellCalls(context), sequenced: false };
  return { calls: toolCalls[requested], sequenced: false };
}

function backgroundTaskCalls(context: Context) {
  const results = context.messages.filter((message) => message.role === 'toolResult');
  const started = results.find((message) => message.role === 'toolResult' && message.toolName === 'Task');
  if (!started) {
    return [{ name: 'Task', arguments: { prompt: 'Report the word delegate-ok and nothing else.', subagent_type: 'generalPurpose' } }];
  }
  if (results.some((message) => message.role === 'toolResult' && message.toolName === 'TaskOutput')) return [];
  const id = JSON.stringify(started).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  return id ? [{ name: 'TaskOutput', arguments: { task_id: id, block: true } }] : [];
}

function shellCalls(context: Context) {
  const results = context.messages.filter((message) => message.role === 'toolResult');
  const started = results.find((message) => message.role === 'toolResult' && message.toolName === 'BackgroundShell');
  if (!started) {
    return [{ name: 'BackgroundShell', arguments: { command: 'echo journey-shell-ready; while :; do sleep 1; done', title: 'Journey shell', notify_on_output: 'journey-shell-ready' } }];
  }
  const listed = results.some((message) => message.role === 'toolResult' && message.toolName === BG_SHELL_LIST);
  if (!listed) return [{ name: BG_SHELL_LIST, arguments: {} }];
  const stopped = results.some((message) => message.role === 'toolResult' && message.toolName === BG_SHELL_STOP);
  if (stopped) return [];
  const text = JSON.stringify(started);
  const id = text.match(/Started background shell ([0-9a-f-]{36})/i)?.[1] ?? text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  return id ? [{ name: BG_SHELL_STOP, arguments: { id } }] : [];
}

function taskIdOf(message: unknown): string | undefined {
  return JSON.stringify(message).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
}

function toolResults(context: Context) {
  return context.messages.filter((message) => message.role === 'toolResult');
}

function taskResumeCalls(context: Context) {
  const tasks = toolResults(context).filter((message) => message.role === 'toolResult' && message.toolName === 'Task');
  if (tasks.length === 0) return [{ name: 'Task', arguments: { prompt: 'first child turn for resume', subagent_type: 'generalPurpose', run_in_background: false } }];
  if (tasks.length > 1) return [];
  const id = taskIdOf(tasks[0]);
  return id ? [{ name: 'Task', arguments: { prompt: 'second child turn after resume', subagent_type: 'generalPurpose', run_in_background: false, resume: id } }] : [];
}

function taskSteerCalls(context: Context) {
  const results = toolResults(context);
  const tasks = results.filter((message) => message.role === 'toolResult' && message.toolName === 'Task');
  if (tasks.length === 0) return [{ name: 'Task', arguments: { prompt: 'JOURNEY:slowchild', subagent_type: 'generalPurpose' } }];
  const id = taskIdOf(tasks[0]);
  if (!id) return [];
  if (!results.some((message) => message.role === 'toolResult' && message.toolName === 'TaskMessage')) return [{ name: 'TaskMessage', arguments: { task_id: id, message: 'steer the running child', mode: 'steer' } }];
  if (!results.some((message) => message.role === 'toolResult' && message.toolName === 'TaskOutput')) return [{ name: 'TaskOutput', arguments: { task_id: id, block: true } }];
  return [];
}

function taskPolicyCalls(context: Context) {
  const tasks = toolResults(context).filter((message) => message.role === 'toolResult' && message.toolName === 'Task');
  if (tasks.length === 0) return [{ name: 'Task', arguments: { prompt: 'policy child turn', subagent_type: 'generalPurpose', run_in_background: false } }];
  if (tasks.length > 1) return [];
  const id = taskIdOf(tasks[0]);
  return id ? [{ name: 'Task', arguments: { prompt: 'policy child turn two', subagent_type: 'comment-sicko', run_in_background: false, resume: id } }] : [];
}

function taskLifecycleCalls(context: Context) {
  const results = toolResults(context);
  const tasks = results.filter((message) => message.role === 'toolResult' && message.toolName === 'Task');
  if (tasks.length === 0) return [{ name: 'Task', arguments: { prompt: 'lifecycle child turn', subagent_type: 'generalPurpose' } }];
  const id = taskIdOf(tasks[0]);
  if (!id) return [];
  if (!results.some((message) => message.role === 'toolResult' && message.toolName === 'TaskOutput')) return [{ name: 'TaskOutput', arguments: { task_id: id, block: true } }];
  if (!results.some((message) => message.role === 'toolResult' && message.toolName === 'TaskMessage')) return [{ name: 'TaskMessage', arguments: { task_id: id, message: 'steer the settled child', mode: 'steer' } }];
  if (!results.some((message) => message.role === 'toolResult' && message.toolName === 'TaskStop')) return [{ name: 'TaskStop', arguments: { task_id: id } }];
  return [];
}

function personaCalls() {
  return ['generalPurpose', 'poteto-agent', 'comment-sicko', 'Comment Sicko', 'ci-watcher', 'thermo-nuclear-code-quality-review'].map((persona) => ({
    name: 'Task',
    arguments: { prompt: `persona probe for ${persona}`, subagent_type: persona, run_in_background: false },
  }));
}

function lastUserText(context: Context): string {
  for (const message of context.messages.toReversed()) {
    if (message.role !== 'user') continue;
    const text = typeof message.content === 'string' ? message.content : message.content.find((block) => block.type === 'text')?.text;
    if (text) return text;
  }
  return '';
}

function holdUntilAbort(stream: ReturnType<typeof createAssistantMessageEventStream>, message: AssistantMessage, signal: AbortSignal | undefined): void {
  const abort = () => {
    const error = { ...message, stopReason: 'aborted' as const, errorMessage: 'Journey child aborted' };
    stream.push({ type: 'error', reason: 'aborted', error });
    stream.end(error);
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
}

function scriptedReply(model: Model<string>, context: Context, signal: AbortSignal | undefined) {
  const logDirectory = process.env.PSTACK_JOURNEY_LOG;
  if (logDirectory)
    appendFileSync(
      join(logDirectory, `requests-${process.pid}.jsonl`),
      `${JSON.stringify({
        model: model.id,
        provider: model.provider,
        systemPrompt: context.systemPrompt,
        tools: context.tools?.map((tool) => tool.name),
        messages: context.messages,
      })}\n`,
    );

  const requested = lastUserText(context).trim();
  const { calls, sequenced } = dispatch(requested, context);
  const answered = context.messages.at(-1)?.role === 'toolResult';
  const content =
    calls && calls.length > 0 && (sequenced || !answered)
      ? calls.map((call, index) => ({ type: 'toolCall' as const, id: `journey-${index}-${context.messages.length}`, name: call.name, arguments: call.arguments }))
      : [{ type: 'text' as const, text: `recorded ${requested.slice(0, 40)}` }];

  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason: content[0]?.type === 'toolCall' ? 'toolUse' : 'stop',
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  const complete = () => {
    stream.push({ type: 'done', reason: message.stopReason === 'stop' ? 'stop' : 'toolUse', message });
    stream.end(message);
  };
  if (requested === 'JOURNEY:agentstop-child') holdUntilAbort(stream, message, signal);
  else if (requested === 'JOURNEY:progress-child' && answered) setTimeout(complete, 300);
  else complete();
  return stream;
}

export default function journeyProvider(pi: ExtensionAPI): void {
  let isChild = false;
  pi.on('session_start', (_event, ctx) => {
    isChild = ctx.sessionManager.getBranch().some((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-identity');
  });
  pi.events.on('pstack:subagent-stats', (stats) => {
    const logDirectory = process.env.PSTACK_JOURNEY_LOG;
    if (logDirectory && !isChild) appendFileSync(join(logDirectory, `root-stats-${process.pid}.jsonl`), `${JSON.stringify(stats)}\n`);
  });
  pi.registerCommand('journey-simple-off', {
    description: 'Clear the fixture simple-mode environment switch.',
    handler: async () => {
      process.env.CLAUDE_CODE_SIMPLE = '';
    },
  });
  pi.registerProvider('journey-test', {
    api: 'openai-completions',
    baseUrl: 'https://unused.invalid',
    apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'recorder', name: 'Journey recorder', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model, context, options) => scriptedReply(model, context, options?.signal),
  });
}
