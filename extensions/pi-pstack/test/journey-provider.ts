import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type ToolCall } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ProviderConfig } from '@earendil-works/pi-coding-agent';

type StreamArguments = Parameters<NonNullable<ProviderConfig['streamSimple']>>;
type CallArguments = ToolCall['arguments'];
type PlannedCall = { name: string; arguments: CallArguments };

const toolCalls: Record<string, PlannedCall[]> = {
  'JOURNEY:todowrite': [
    { name: 'TodoWrite', arguments: { todos: [
      { id: 'one', content: 'Read the playbook', status: 'completed' },
      { id: 'two', content: 'Run the journey', status: 'in_progress' },
      { id: 'three', content: 'Report findings', status: 'pending' },
    ] } },
  ],
  'JOURNEY:todomerge': [
    { name: 'TodoWrite', arguments: { todos: [{ id: 'three', content: 'Report findings', status: 'completed' }], merge: true } },
  ],
  'JOURNEY:modeon': [{ name: 'pstack_mode', arguments: { enabled: true } }],
  'JOURNEY:modeoff': [{ name: 'pstack_mode', arguments: { enabled: false } }],
  'JOURNEY:context': [{ name: 'pstack_context', arguments: {} }],
  'JOURNEY:history': [{ name: 'pstack_context', arguments: { history: true } }],
  'JOURNEY:cloud': [{ name: 'Task', arguments: { prompt: 'cloud work', environment: 'cloud' } }],
  'JOURNEY:badmodel': [{ name: 'Task', arguments: { prompt: 'modelled work', model: 'nowhere/missing', run_in_background: false } }],
  'JOURNEY:question': [{ name: 'AskQuestion', arguments: { questions: [{ id: 'approval', prompt: 'Approve the journey?', options: [
    { id: 'approve', label: 'Approve' }, { id: 'decline', label: 'Decline' },
  ] }] } }],
  'JOURNEY:task': [{ name: 'Task', arguments: { prompt: 'Report the word delegate-ok and nothing else.', subagent_type: 'generalPurpose', run_in_background: false } }],
  'JOURNEY:subagent': [{ name: 'Task', arguments: { prompt: 'Report the word delegate-ok and nothing else.', subagent_type: 'not-a-persona' } }],
  'JOURNEY:shellexit': [{ name: 'BackgroundShell', arguments: { command: "perl -MPOSIX -e 'POSIX::setsid(); sleep 300' & sleep 0.3", title: 'Escaping shell' } }],
};

function escapingShellCalls(context: Context) {
  const started = context.messages.filter(message => message.role === 'toolResult' && message.toolName === 'BackgroundShell').at(-1);
  const id = started === undefined ? undefined : JSON.stringify(started).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  return id ? [{ name: 'BackgroundShellStop', arguments: { id } }] : [];
}

function dispatch(requested: string, context: Context): { calls: PlannedCall[] | undefined; sequenced: boolean } {
  if (requested === 'JOURNEY:tasklist') return { calls: backgroundTaskCalls(context), sequenced: true };
  if (requested === 'JOURNEY:shell') return { calls: shellCalls(context), sequenced: true };
  if (requested === 'JOURNEY:shellexitstop') return { calls: escapingShellCalls(context), sequenced: false };
  return { calls: toolCalls[requested], sequenced: false };
}

function backgroundTaskCalls(context: Context) {
  const results = context.messages.filter(message => message.role === 'toolResult');
  const started = results.find(message => message.role === 'toolResult' && message.toolName === 'Task');
  if (!started) {
    return [{ name: 'Task', arguments: { prompt: 'Report the word delegate-ok and nothing else.', subagent_type: 'generalPurpose' } }];
  }
  if (results.some(message => message.role === 'toolResult' && message.toolName === 'TaskOutput')) return [];
  const id = JSON.stringify(started).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  return id ? [{ name: 'TaskOutput', arguments: { task_id: id, block: true } }] : [];
}

function shellCalls(context: Context) {
  const results = context.messages.filter(message => message.role === 'toolResult');
  const started = results.find(message => message.role === 'toolResult' && message.toolName === 'BackgroundShell');
  if (!started) {
    return [{ name: 'BackgroundShell', arguments: { command: 'echo journey-shell-ready', title: 'Journey shell', notify_on_output: 'journey-shell-ready' } }];
  }
  const listed = results.some(message => message.role === 'toolResult' && message.toolName === 'BackgroundShellList');
  if (!listed) return [{ name: 'BackgroundShellList', arguments: {} }];
  const stopped = results.some(message => message.role === 'toolResult' && message.toolName === 'BackgroundShellStop');
  if (stopped) return [];
  const text = JSON.stringify(started);
  const id = text.match(/Started background shell ([0-9a-f-]{36})/i)?.[1] ?? text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  return id ? [{ name: 'BackgroundShellStop', arguments: { id } }] : [];
}

function lastUserText(context: Context): string {
  for (const message of context.messages.toReversed()) {
    if (message.role !== 'user') continue;
    const text = typeof message.content === 'string'
      ? message.content
      : message.content.find(block => block.type === 'text')?.text;
    if (text) return text;
  }
  return '';
}

function scriptedReply(model: Model<string>, context: Context) {
  const logDirectory = process.env.PSTACK_JOURNEY_LOG;
  if (logDirectory) appendFileSync(join(logDirectory, `requests-${process.pid}.jsonl`), `${JSON.stringify({
    systemPrompt: context.systemPrompt,
    tools: context.tools?.map(tool => tool.name),
    messages: context.messages,
  })}\n`);

  const requested = lastUserText(context).trim();
  const { calls, sequenced } = dispatch(requested, context);
  const answered = context.messages.at(-1)?.role === 'toolResult';
  const content = calls && calls.length > 0 && (sequenced || !answered)
    ? calls.map((call, index) => ({ type: 'toolCall' as const, id: `journey-${index}-${context.messages.length}`, name: call.name, arguments: call.arguments }))
    : [{ type: 'text' as const, text: `recorded ${requested.slice(0, 40)}` }];

  const message: AssistantMessage = {
    role: 'assistant', api: model.api, provider: model.provider, model: model.id, content,
    stopReason: content[0]?.type === 'toolCall' ? 'toolUse' : 'stop', timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'done', reason: message.stopReason === 'stop' ? 'stop' : 'toolUse', message });
  stream.end(message);
  return stream;
}

export default function journeyProvider(pi: ExtensionAPI): void {
  pi.registerProvider('journey-test', {
    api: 'openai-completions', baseUrl: 'https://unused.invalid', apiKey: 'fixture-only-not-a-credential',
    models: [{ id: 'recorder', name: 'Journey recorder', reasoning: false, input: ['text'],
      contextWindow: 1000000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: scriptedReply,
  });
}
