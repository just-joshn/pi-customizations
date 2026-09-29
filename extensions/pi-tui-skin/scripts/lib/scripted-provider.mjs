#!/usr/bin/env node
/**
 * The scripted provider fixture the smoke sessions load.
 *
 * The source is written into a temp file and handed to pi with `--extension`.
 * It answers from the transcript with deterministic tool calls and reply
 * markers, so every scenario asserts on a known turn. It never touches the
 * network.
 */

export const PROVIDER_SOURCE = `import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const READ_README = { type: 'toolCall', id: 'smoke-read', name: 'read', arguments: { path: 'README.md' } };
const READ_UNICODE = { type: 'toolCall', id: 'smoke-unicode', name: 'read', arguments: { path: 'unicode.txt' } };
const EDIT_NOTE = { type: 'toolCall', id: 'smoke-journey-edit', name: 'edit', arguments: { path: 'note.txt', oldText: 'alpha', newText: 'beta' } };
const GREP = { type: 'toolCall', id: 'smoke-journey-grep', name: 'grep', arguments: { pattern: 'TUI_SKIN' } };

const TOOL_TURNS = [
  READ_README,
  { type: 'toolCall', id: 'smoke-bash', name: 'bash', arguments: { command: 'echo TUI_SKIN_BASH_OK' } },
  { type: 'toolCall', id: 'smoke-write', name: 'write', arguments: { path: 'written.txt', content: 'TUI_SKIN_WRITTEN\\n' } },
  { type: 'toolCall', id: 'smoke-edit', name: 'edit', arguments: { path: 'note.txt', oldText: 'alpha', newText: 'beta' } },
  { type: 'toolCall', id: 'smoke-grep', name: 'grep', arguments: { pattern: 'TUI_SKIN' } },
  { type: 'toolCall', id: 'smoke-find', name: 'find', arguments: { pattern: '*.txt' } },
  { type: 'toolCall', id: 'smoke-ls', name: 'ls', arguments: { path: '.' } },
];

const SCRIPTS = [
  { trigger: 'one tool', calls: [READ_README], sequential: true, done: 'TUI_SKIN_ONE_DONE' },
  { trigger: 'error tool', calls: [{ type: 'toolCall', id: 'smoke-error', name: 'bash', arguments: { command: 'echo TUI_SKIN_ERROR_MSG && exit 3' } }], sequential: true, done: 'TUI_SKIN_ERROR_RECOVERED' },
  { trigger: 'parallel tools', calls: [READ_README, { type: 'toolCall', id: 'smoke-parallel', name: 'bash', arguments: { command: 'echo TUI_SKIN_PARALLEL_OK' } }], sequential: false, done: 'TUI_SKIN_PARALLEL_DONE' },
  { trigger: 'long output', calls: [{ type: 'toolCall', id: 'smoke-long', name: 'bash', arguments: { command: 'seq 1 2000' } }], sequential: true, done: 'TUI_SKIN_LONG_DONE' },
  { trigger: 'read unicode', calls: [READ_UNICODE], sequential: true, done: 'TUI_SKIN_UNICODE_DONE' },
  { trigger: 'journey', calls: [READ_README, EDIT_NOTE, GREP, { type: 'toolCall', id: 'smoke-journey-bash', name: 'bash', arguments: { command: 'echo TUI_SKIN_JOURNEY_BASH' } }], sequential: true, done: 'TUI_SKIN_JOURNEY_DONE' },
];

function usage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join(' ');
}

function transcriptText(context) {
  return context.messages.filter((message) => message.role === 'user').map((message) => textOf(message)).join('\\n');
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider('tui-skin-scripted', {
    name: 'Reference UI Scripted',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'smoke-not-a-real-key',
    api: 'tui-skin-scripted',
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const transcript = transcriptText(context);
      const toolResults = context.messages.filter((message) => message.role === 'toolResult').length;
      const slow = transcript.includes('SLOW');
      const wantsSlowTool = transcript.includes('run slow') && toolResults === 0;

      let calls = [];
      let text;
      if (wantsSlowTool) {
        calls = [{ type: 'toolCall', id: 'smoke-slow', name: 'bash', arguments: { command: 'sleep 4 && echo SLOW_MARKER_LATE' } }];
      } else if (transcript.includes('run tools')) {
        if (toolResults < TOOL_TURNS.length) calls = [TOOL_TURNS[toolResults]];
        else text = 'TUI_SKIN_TOOLS_DONE';
      } else if (transcript.includes('run slow')) {
        text = 'TUI_SKIN_SLOW_DONE';
      } else {
        const script = SCRIPTS.find((entry) => transcript.includes(entry.trigger));
        const pending = script !== undefined && (script.sequential ? toolResults < script.calls.length : toolResults === 0);
        if (script === undefined) text = 'TUI_SKIN_REPLY_OK';
        else if (pending) calls = script.sequential ? [script.calls[toolResults]] : script.calls;
        else text = script.done;
        if (text === 'TUI_SKIN_REPLY_OK' && transcript.includes('follow up')) text = 'TUI_SKIN_FOLLOWUP_DONE';
      }

      const turnMs = Number(process.env.PI_TUI_SKIN_SMOKE_TURN_MS ?? '0');
      const waitTurn = () => (Number.isFinite(turnMs) && turnMs > 0 ? new Promise((resolve) => setTimeout(resolve, turnMs)) : Promise.resolve());
      (async () => {
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: 'pending', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        const aborted = () => options?.signal?.aborted === true;
        const endAborted = () => {
          message.stopReason = 'aborted';
          stream.push({ type: 'done', reason: 'aborted', message });
          stream.end();
        };
        if (calls.length > 0) {
          for (let index = 0; index < calls.length; index++) {
            if (aborted()) return endAborted();
            const call = calls[index];
            message.content.push(call);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            await waitTurn();
            if (aborted()) return endAborted();
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: call, partial: message });
          }
        } else {
          message.content.push({ type: 'text', text: '' });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          // Pace the text turn too, so a row scenario can see the frame between a tool result and the closing reply.
          await waitTurn();
          if (aborted()) return endAborted();
          const chunks = slow ? ['SLOW ', 'REPLY ', 'STREAMING ', text] : [text];
          for (const chunk of chunks) {
            if (aborted()) return endAborted();
            if (message.content[0].text.endsWith('TUI_SKIN_REPLY_OK')) break;
            message.content[0].text += chunk;
            stream.push({ type: 'text_delta', contentIndex: 0, delta: chunk, partial: message });
            if (slow) await new Promise((resolve) => setTimeout(resolve, 900));
          }
          if (aborted()) return endAborted();
          stream.push({ type: 'text_end', contentIndex: 0, content: message.content[0].text, partial: message });
        }
        if (aborted()) return endAborted();
        await waitTurn();
        if (aborted()) return endAborted();
        message.stopReason = calls.length > 0 ? 'toolUse' : 'stop';
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      })();
      return stream;
    },
    models: [{ id: 'smoke', name: 'Reference UI Scripted', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
}
`;
