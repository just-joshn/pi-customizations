// Test-only Pi extension: a scripted actor built on Pi's faux provider. The real Pi binary and the real pstack
// extension run unchanged. Only the model's answers are scripted.
//
// PSTACK_SCENARIO names a JSON file { actors: { <actor>: Step[] } }. The actor is PSTACK_WORKER_ID, or "parent".
// Each provider call consumes the next step of its actor:
//   { tool, args } | [{ tool, args }, ...]   call these tools (several in one array run in one assistant message)
//   { text }                                 reply with text and end the turn
//   { await: { wake: <workerId> } }          end the turn until a pstack-worker wake for that worker is in the context
// After the last step the actor answers "(script complete)", so a late wake turn does no harm.
import { readFileSync } from 'node:fs';

import type { AssistantMessage, Message, TextContent } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type Call = { tool: string; args: Record<string, unknown> };
type Step = Call | Call[] | { text: string } | { await: { wake: string } };

const textOf = (content: string | readonly { type: string }[]): string =>
  typeof content === 'string'
    ? content
    : content
        .filter((part): part is TextContent => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

function script(): Step[] {
  const path = process.env['PSTACK_SCENARIO'];
  if (path === undefined) return [{ text: 'no PSTACK_SCENARIO' }];
  const actors = (JSON.parse(readFileSync(path, 'utf8')) as { actors: Record<string, Step[]> }).actors;
  return actors[process.env['PSTACK_WORKER_ID'] ?? 'parent'] ?? [{ text: `no script for ${process.env['PSTACK_WORKER_ID'] ?? 'parent'}` }];
}

let cursor = 0;

function wakeSeen(messages: readonly Message[], workerId: string): boolean {
  return messages.some((message) => message.role === 'user' && textOf(message.content).startsWith(`pstack worker ${workerId} in run `));
}

function respond(messages: readonly Message[]): AssistantMessage {
  const steps = script();
  const step = steps[cursor];
  if (step === undefined) return fauxAssistantMessage('(script complete)');
  if (!Array.isArray(step) && 'await' in step) {
    if (!wakeSeen(messages, step.await.wake)) return fauxAssistantMessage(`waiting for worker ${step.await.wake}`);
    cursor += 1;
    return respond(messages);
  }
  cursor += 1;
  if (!Array.isArray(step) && 'text' in step) return fauxAssistantMessage(step.text);
  const calls = Array.isArray(step) ? step : [step];
  return fauxAssistantMessage(
    calls.map((call) => fauxToolCall(call.tool, call.args as never)),
    { stopReason: 'toolUse' },
  );
}

export default function scenarioModel(pi: ExtensionAPI): void {
  const handle = fauxProvider({ provider: 'sim', models: [{ id: 'claude-sim', reasoning: true }, { id: 'grok-sim', reasoning: true }, { id: 'deepseek-sim' }] });
  const next = (context: { messages: readonly Message[] }) => {
    handle.appendResponses([next]);
    return respond(context.messages);
  };
  handle.setResponses([next]);
  pi.registerProvider(handle.provider);
}
