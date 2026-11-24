import { type AssistantMessage, type Message, normalizeContext, type Tool, type ToolResultMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';
import { declaredToolNames, instructions, renderPrompt, systemPrompt } from '../src/transcript.ts';

const SYSTEM = 'Be brief.';
const TIMESTAMP = 1;

const readTool: Tool = { name: 'read', description: 'Read a file', parameters: { type: 'object' } };
const bashTool: Tool = { name: 'bash', description: 'Run a command', parameters: { type: 'object' } };

const usage: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function context(messages: readonly Message[], tools: readonly Tool[] = [readTool]): TranscriptContext {
  return normalizeContext({ systemPrompt: SYSTEM, messages: [...messages], tools: [...tools] });
}

function assistant(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt',
    usage,
    stopReason: 'stop',
    timestamp: TIMESTAMP,
  };
}

function toolResult(text: string, extra: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: TIMESTAMP,
    ...extra,
  };
}

function texts(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('\n');
}

it('replays a user, assistant, and tool result, and skips the system prompt', () => {
  const prompt = renderPrompt(
    context([
      { role: 'user', content: 'Read the file', timestamp: TIMESTAMP },
      assistant([
        { type: 'text', text: 'Looking.' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
      ]),
      toolResult('file body'),
    ]),
  );
  expect(texts(prompt)).toBe(['Read the file', '[assistant]\nLooking.\nread {"path":"a.ts"}', '[tool result: read]\nfile body'].join('\n'));
  expect(texts(prompt)).not.toContain(SYSTEM);
});

it('keeps a user image in place', () => {
  const prompt = renderPrompt(
    context([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', data: 'abc', mimeType: 'image/png' },
        ],
        timestamp: TIMESTAMP,
      },
    ]),
  );
  expect(prompt[0]).toEqual({ type: 'text', text: 'What is this?' });
  expect(prompt[1]).toEqual({ type: 'image', data: 'abc', mimeType: 'image/png' });
});

it('drops assistant thinking', () => {
  const prompt = renderPrompt(
    context([
      { role: 'user', content: 'hi', timestamp: TIMESTAMP },
      assistant([
        { type: 'thinking', thinking: 'secret reasoning' },
        { type: 'text', text: 'Hello.' },
      ]),
    ]),
  );
  expect(texts(prompt)).toContain('[assistant]\nHello.');
  expect(texts(prompt)).not.toContain('secret reasoning');
});

it('returns nothing for an empty conversation', () => {
  expect(renderPrompt(normalizeContext({ messages: [] }))).toEqual([]);
  const systemOnly = normalizeContext({ systemPrompt: SYSTEM, messages: [] });
  expect(renderPrompt(systemOnly)).toEqual([]);
  expect(systemPrompt(systemOnly)).toBe(SYSTEM);
  expect(instructions(systemOnly).startsWith(SYSTEM)).toBe(true);
});

it('names a declared tool in the instructions and omits an undeclared one', () => {
  const prompt = instructions(context([{ role: 'user', content: 'hi', timestamp: TIMESTAMP }], [readTool, bashTool]));
  expect(prompt.endsWith('Do not run commands or edit files yourself.\nread: view_file\nbash: run_command')).toBe(true);
  const readOnly = instructions(context([{ role: 'user', content: 'hi', timestamp: TIMESTAMP }], [readTool]));
  expect(readOnly).toContain('read: view_file');
  expect(readOnly).not.toContain('bash');
  expect(declaredToolNames(context([], [readTool]))).toEqual(new Set(['read']));
});

it('carries the Pi system prompt ahead of the tool contract', () => {
  const prompt = instructions(context([{ role: 'user', content: 'hi', timestamp: TIMESTAMP }], [readTool]));
  expect(prompt.startsWith(SYSTEM)).toBe(true);
  expect(prompt).toContain('Do not run commands or edit files yourself.');
});

it('marks an error result and keeps its image', () => {
  const prompt = renderPrompt(
    context([
      { role: 'user', content: 'go', timestamp: TIMESTAMP },
      toolResult('failed', {
        isError: true,
        content: [
          { type: 'text', text: 'failed' },
          { type: 'image', data: 'err', mimeType: 'image/png' },
        ],
      }),
    ]),
  );
  expect(prompt[1]).toEqual({ type: 'text', text: '[tool result: read]\n[error]\nfailed' });
  expect(prompt[2]).toEqual({ type: 'image', data: 'err', mimeType: 'image/png' });
});
