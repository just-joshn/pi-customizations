// Test-only Pi extension: a deterministic model built on Pi's own faux provider.
// The last user message drives it with one directive line:
//   @@say <text>                 reply with exactly <text>
//   @@sys                        reply with the current system prompt
//   @@tools-list                 reply with the declared tool names, comma separated
//   @@count                      reply USERS=<number of user messages in the transcript>
//   @@loop-until <n>             while fewer than n user messages exist, call Loop {wake_in:"1s"}; then reply DONE
//   @@fail <message>             end the turn with an error stop reason
//   @@sleep <ms> <text>          wait, then reply with <text>
//   @@task-chain <n>             call Task with prompt "@@task-chain <n-1>"; at 0 reply LEAF
//   @@script <json array>        step i (i = assistant messages since that user message) is
//                                {"tool":name,"args":{}} | [{"tool":...},...] | {"text":...}
//                                after the last step, reply "RESULTS:" plus every tool result text since the user message
// Anything else is echoed as "ECHO: <text>".
import type { AssistantMessage, Message, TextContent, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Step = { tool: string; args: ToolCall['arguments'] } | { text: string };

const textOf = (content: string | readonly { type: string }[]): string =>
  typeof content === 'string'
    ? content
    : content
        .filter((part): part is TextContent => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

function lastUserIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index]?.role === 'user') return index;
  return -1;
}

function toolCalls(step: Step | Step[]): ToolCall[] {
  const steps = Array.isArray(step) ? step : [step];
  return steps.flatMap((item) => ('tool' in item ? [fauxToolCall(item.tool, item.args)] : []));
}

function scriptReply(script: string, after: readonly Message[]): AssistantMessage {
  const steps = JSON.parse(script) as (Step | Step[])[];
  const index = after.filter((message) => message.role === 'assistant').length;
  const step = steps[index];
  if (step === undefined) {
    const results = after.filter((message): message is ToolResultMessage => message.role === 'toolResult');
    return fauxAssistantMessage(`RESULTS:\n${results.map((result) => `[${result.toolName}${result.isError ? ' error' : ''}] ${textOf(result.content)}`).join('\n')}`);
  }
  if (!Array.isArray(step) && 'text' in step) return fauxAssistantMessage(step.text);
  return fauxAssistantMessage(toolCalls(step), { stopReason: 'toolUse' });
}

function directiveReply(directive: string, argument: string, messages: readonly Message[], after: readonly Message[]): AssistantMessage | Promise<AssistantMessage> | undefined {
  switch (directive) {
    case 'say':
      return fauxAssistantMessage(argument);
    case 'sys':
      return fauxAssistantMessage(getCurrentSystemPrompt(messages));
    case 'loop-until': {
      const users = messages.filter((message) => message.role === 'user').length;
      if (users >= Number(argument) || after.some((message) => message.role === 'toolResult')) return fauxAssistantMessage(users >= Number(argument) ? 'DONE' : 'WAKE SET');
      return fauxAssistantMessage([fauxToolCall('Loop', { wake_in: '1s' })], { stopReason: 'toolUse' });
    }
    case 'count':
      return fauxAssistantMessage(`USERS=${messages.filter((message) => message.role === 'user').length}`);
    case 'tools-list':
      return fauxAssistantMessage(
        getCurrentTools(messages)
          .map((tool) => tool.name)
          .join(','),
      );
    case 'fail':
      return fauxAssistantMessage(fauxText(''), { stopReason: 'error', errorMessage: argument || 'scripted failure' });
    case 'sleep': {
      const [ms = '0', ...words] = argument.split(' ');
      return new Promise((resolve) => setTimeout(() => resolve(fauxAssistantMessage(words.join(' '))), Number(ms)));
    }
    case 'task-chain': {
      const depth = Number(argument);
      if (depth <= 0) return fauxAssistantMessage('LEAF');
      if (after.some((message) => message.role === 'toolResult')) return scriptReply('[]', after);
      return fauxAssistantMessage([fauxToolCall('Task', { description: `chain ${depth}`, prompt: `@@task-chain ${depth - 1}` })], { stopReason: 'toolUse' });
    }
    case 'script':
      return scriptReply(argument, after);
    default:
      return undefined;
  }
}

export function respond(messages: readonly Message[]): AssistantMessage | Promise<AssistantMessage> {
  const userIndex = lastUserIndex(messages);
  const user = messages[userIndex];
  const text = user === undefined ? '' : textOf(user.content);
  const after = messages.slice(userIndex + 1);
  const line = text.split('\n').find((candidate) => candidate.startsWith('@@'));
  if (line !== undefined) {
    const [, directive = '', argument = ''] = /^@@([a-z-]+)\s?([\s\S]*)$/.exec(line) ?? [];
    const reply = directiveReply(directive, argument, messages, after);
    if (reply !== undefined) return reply;
  }
  return fauxAssistantMessage(`ECHO: ${text}`);
}

export default function scriptedModel(pi: ExtensionAPI): void {
  const handle = fauxProvider({ provider: 'scripted', models: [{ id: 'echo', reasoning: true }, { id: 'plain' }] });
  const step = (context: { messages: readonly Message[] }) => {
    handle.appendResponses([step]);
    return respond(context.messages);
  };
  handle.setResponses([step]);
  pi.registerProvider(handle.provider);
  // RPC has no reload command, so lifecycle tests reach ctx.reload() through this one.
  pi.registerCommand('test-reload', { description: 'Test only: reload the runtime', handler: async (_args, ctx) => ctx.reload() });
}
