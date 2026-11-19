import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { discoverAgents } from '../src/subagent/agents.ts';
import { executeSubagent } from '../src/subagent/dispatch.ts';
import { getPiInvocation } from '../src/subagent/pi-invocation.ts';
import { applyMessage, createResultStream, parseMessageEnd } from '../src/subagent/result-stream.ts';
import { createUnstartedResult } from '../src/subagent/results.ts';

const AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';
const TOKENS = 3;
const COST_TOTAL = 0.25;
const FULL_USAGE = {
  input: TOKENS,
  output: TOKENS,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: TOKENS,
  cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0, total: COST_TOTAL },
};

let root = '';
let userHome = '';
let project = '';

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'equivalence-subagent-')));
  userHome = path.join(root, 'home');
  project = path.join(root, 'proj');
  fs.mkdirSync(project, { recursive: true });
  vi.stubEnv(AGENT_DIR_ENV, userHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const writeAgent = (dir: string, name: string, frontmatter: string): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), `---\n${frontmatter}---\nbody of ${name}\n`);
};
const endLine = (message: unknown): string => JSON.stringify({ type: 'message_end', message });
const baseResult = () => createUnstartedResult('scout', 'look', undefined, 'pending');

describe('agent frontmatter', () => {
  test('an agent without tools or model keeps both keys, set to undefined, in the original order', () => {
    writeAgent(path.join(userHome, 'agents'), 'plain', 'name: plain\ndescription: d\n');
    const [agent] = discoverAgents(project, 'user').agents;
    expect(agent).toStrictEqual({
      name: 'plain',
      description: 'd',
      tools: undefined,
      model: undefined,
      systemPrompt: 'body of plain',
      source: 'user',
      filePath: path.join(userHome, 'agents', 'plain.md'),
    });
    expect(Object.keys(agent ?? {})).toEqual(['name', 'description', 'tools', 'model', 'systemPrompt', 'source', 'filePath']);
  });

  test('extra frontmatter keys are ignored and tools and model are normalized', () => {
    writeAgent(path.join(userHome, 'agents'), 'rich', 'name: rich\ndescription: d\ntools: read, bash\nmodel: m\nfuture: [1]\n');
    expect(discoverAgents(project, 'user').agents[0]).toMatchObject({ tools: ['read', 'bash'], model: 'm' });
  });

  test.each([
    ['a numeric name', 'name: 5\ndescription: d\n'],
    ['a missing description', 'name: x\n'],
    ['a list instead of a map', '- name\n- description\n'],
    ['a scalar', 'just text\n'],
  ])('skips an agent with %s', (_label, frontmatter) => {
    writeAgent(path.join(userHome, 'agents'), 'bad', frontmatter);
    expect(discoverAgents(project, 'user').agents).toEqual([]);
  });
});

describe('a streamed message_end', () => {
  test('is returned untouched, with every usage and cost key in the order it came', () => {
    const message = { role: 'assistant', content: [], api: 'a', model: 'm', usage: FULL_USAGE, stopReason: 'stop', timestamp: 1 };
    const parsed = parseMessageEnd(endLine(message));
    expect(parsed).toStrictEqual(message);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(message));
  });

  test('is returned untouched for user and tool result messages with extra keys', () => {
    const toolResult = { zeta: 1, role: 'toolResult', alpha: { deep: [1] } };
    expect(JSON.stringify(parseMessageEnd(endLine(toolResult)))).toBe(JSON.stringify(toolResult));
  });

  test.each([
    ['an unknown role', { role: 'custom' }],
    ['no role', { content: [] }],
    ['a role that only looks like one', { role: ['user'] }],
  ])('is ignored with %s', (_label, message) => {
    expect(parseMessageEnd(endLine(message))).toBeUndefined();
  });

  test.each([
    ['null', 'null'],
    ['a message_end without a message', JSON.stringify({ type: 'message_end' })],
  ])('throws on %s, as reading it always did', (_label, line) => {
    expect(() => parseMessageEnd(line)).toThrow(TypeError);
  });

  test.each([['5'], ['"text"'], ['[]'], ['{}']])('ignores the JSON value %s', (line) => {
    expect(parseMessageEnd(line)).toBeUndefined();
  });
});

describe('an assistant message with an incomplete usage', () => {
  test('is accepted by the parser and fails where usage is read, as it always did', () => {
    const message = parseMessageEnd(endLine({ role: 'assistant', content: [] }));
    expect(message?.role).toBe('assistant');
    expect(() => applyMessage(baseResult(), message as never)).toThrow(TypeError);
  });

  test('adds up what is there, with a missing count becoming NaN', () => {
    const line = endLine({ role: 'assistant', content: [], usage: { input: 1, output: 2, cost: {} } });
    const result = applyMessage(baseResult(), parseMessageEnd(line) as never);
    expect(result.usage.input).toBe(1);
    expect(result.usage.cacheRead).toBeNaN();
    expect(result.usage.cost).toBeNaN();
  });

  test('throws out of the stream, which gives up on the chunk', () => {
    const stream = createResultStream(baseResult(), () => undefined);
    expect(() => stream.onStdoutChunk(`${endLine({ role: 'assistant' })}\n`)).toThrow(TypeError);
  });
});

describe('an unknown agent scope', () => {
  const ctx = (): ExtensionContext => ({ cwd: project, hasUI: false, model: undefined, thinkingLevel: undefined }) as unknown as ExtensionContext;
  const listed = async (params: Parameters<typeof executeSubagent>[0]): Promise<string> => {
    const result = await executeSubagent(params, undefined, undefined, ctx());
    return result.content[0]?.type === 'text' ? result.content[0].text : '';
  };

  test('lists project agents only, as it always did', async () => {
    writeAgent(path.join(userHome, 'agents'), 'mine', 'name: mine\ndescription: d\ntools: read\n');
    writeAgent(path.join(project, '.pi', 'agents'), 'repo', 'name: repo\ndescription: d\ntools: read\n');
    const text = await listed({ agentScope: 'nope' } as never);
    expect(text).toContain('repo (project)');
    expect(text).not.toContain('mine');
  });

  test('a null scope is the user scope', async () => {
    writeAgent(path.join(userHome, 'agents'), 'mine', 'name: mine\ndescription: d\ntools: read\n');
    expect(await listed({ agentScope: null } as never)).toContain('mine (user)');
  });
});

describe('the Pi invocation', () => {
  test('runs the current script, or Pi when there is none', () => {
    const { command, args } = getPiInvocation(['--mode', 'json']);
    expect(args.slice(-2)).toEqual(['--mode', 'json']);
    expect(command).toBe(args.length > 2 ? process.execPath : command);
  });
});
