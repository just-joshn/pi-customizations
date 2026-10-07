#!/usr/bin/env node
/**
 * Scripted provider for the user-perspective probe sessions.
 *
 * The pi-tui-skin smoke provider in `extensions/pi-tui-skin/scripts/lib/scripted-provider.mjs`
 * answers read/bash/write/edit/grep/find/ls rows but never emits a thinking
 * block and never calls the powershell tool. This fixture adds exactly those
 * two turns plus a two-command parallel turn that the activity widget renders
 * as "Running 2 commands". It never touches the network.
 */

export const PROBE_PROVIDER_SOURCE = `import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

function usage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join(' ');
}

export default function (pi) {
  pi.registerProvider('upi-probe', {
    name: 'UPI Probe Scripted',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'probe-not-a-real-key',
    api: 'upi-probe',
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const messages = context.messages;
      const lastUserWith = (trigger) => {
        let index = -1;
        messages.forEach((message, at) => {
          if (message.role === 'user' && textOf(message).includes(trigger)) index = at;
        });
        return index;
      };
      const toolResultsAfter = (index) => messages.slice(index + 1).filter((message) => message.role === 'toolResult').length;
      const pending = (trigger) => {
        const index = lastUserWith(trigger);
        return index >= 0 && toolResultsAfter(index) === 0;
      };

      const TRIGGERS = [
        { trigger: 'slow pair', kind: 'tools', done: 'PROBE_PAIR_DONE' },
        { trigger: 'powershell row', kind: 'powershell', done: 'PROBE_PWSH_DONE' },
        { trigger: 'think', kind: 'think', done: 'PROBE_THINK_DONE' },
      ];
      const latest = TRIGGERS.filter((entry) => lastUserWith(entry.trigger) >= 0).sort((a, b) => lastUserWith(b.trigger) - lastUserWith(a.trigger))[0];
      let step = { kind: 'text', text: 'PROBE_REPLY_OK' };
      if (latest) step = latest.kind === 'think' ? { kind: 'think' } : !pending(latest.trigger) ? { kind: 'text', text: latest.done } : { kind: latest.kind };

      (async () => {
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: 'pending', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        let toolUse = false;
        if (step.kind === 'tools') {
          toolUse = true;
          const calls = [
            { type: 'toolCall', id: 'probe-slow-a', name: 'bash', arguments: { command: 'sleep 4 && echo PROBE_SLOW_A' } },
            { type: 'toolCall', id: 'probe-slow-b', name: 'bash', arguments: { command: 'sleep 4 && echo PROBE_SLOW_B' } },
          ];
          calls.forEach((call, index) => {
            message.content.push(call);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: call, partial: message });
          });
        } else if (step.kind === 'powershell') {
          toolUse = true;
          const call = { type: 'toolCall', id: 'probe-pwsh', name: 'powershell', arguments: { command: 'Write-Output PROBE_PWSH' } };
          message.content.push(call);
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: call, partial: message });
        } else if (step.kind === 'think') {
          message.content.push({ type: 'thinking', thinking: '' });
          stream.push({ type: 'thinking_start', contentIndex: 0, partial: message });
          message.content[0].thinking += 'PROBE_THINKING_BODY';
          stream.push({ type: 'thinking_delta', contentIndex: 0, delta: 'PROBE_THINKING_BODY', partial: message });
          stream.push({ type: 'thinking_end', contentIndex: 0, content: 'PROBE_THINKING_BODY', partial: message });
          message.content.push({ type: 'text', text: 'PROBE_THINK_DONE' });
          stream.push({ type: 'text_start', contentIndex: 1, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 1, delta: 'PROBE_THINK_DONE', partial: message });
          stream.push({ type: 'text_end', contentIndex: 1, content: 'PROBE_THINK_DONE', partial: message });
        } else {
          message.content.push({ type: 'text', text: step.text });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: step.text, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: step.text, partial: message });
        }
        message.stopReason = toolUse ? 'toolUse' : 'stop';
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      })();

      return stream;
    },
    models: [{ id: 'probe', name: 'UPI Probe Scripted', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
}
`;
