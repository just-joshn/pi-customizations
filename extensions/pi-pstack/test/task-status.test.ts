import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { subagentDir } from '../src/paths.ts';
import { writeRecord } from '../src/task/records.ts';
import { agentStatus, lastAssistantText, listAgentStatuses, registerAgentStatus, statusText } from '../src/task/status.ts';

const idOf = (n: number) => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
let dir = '';

function addAgent(n: number, extra: Record<string, unknown> = {}): string {
  const agentId = idOf(n);
  writeRecord(dir, { agentId, type: 'generalPurpose', readonly: false, cwd: '/w/app', createdAt: new Date(Date.UTC(2026, 9, 28, 10, n)).toISOString(), depth: 1, ...extra });
  return agentId;
}

function addTranscript(agentId: string, texts: string[]): string {
  const header = { type: 'session', version: 3, id: agentId, timestamp: '2026-10-28T10:00:00.000Z', cwd: '/w/app' };
  const messages = texts.map((text, index) => ({
    type: 'message',
    id: `e${index}`,
    parentId: index === 0 ? null : `e${index - 1}`,
    timestamp: '2026-10-28T10:00:01.000Z',
    message: { role: index % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text }] },
  }));
  const path = join(dir, `2026-10-28T10-00-00-000Z_${agentId}.jsonl`);
  writeFileSync(path, `${[header, ...messages].map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return path;
}

const deadPid = () => spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'status-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('agent_status: one agent', () => {
  test('running while the run lock names a live pid', () => {
    const agentId = addAgent(1, { model: { provider: 'p', id: 'm', thinking: 'high' } });
    addTranscript(agentId, ['task', 'working on it']);
    writeFileSync(join(dir, `${agentId}.lock`), String(process.pid));
    expect(agentStatus(dir, agentId)).toMatchObject({ agentId, state: 'running', pid: process.pid, type: 'generalPurpose', model: 'p/m:high', directory: '/w/app', createdAt: '2026-10-28T10:01:00.000Z', lastText: 'working on it' });
  });

  test('idle with no lock or a lock whose pid is dead', () => {
    const agentId = addAgent(1);
    addTranscript(agentId, ['task', 'done']);
    expect(agentStatus(dir, agentId).state).toBe('idle');
    writeFileSync(join(dir, `${agentId}.lock`), deadPid());
    expect(agentStatus(dir, agentId).state).toBe('idle');
  });

  test('missing without a record or transcript', () => {
    expect(agentStatus(dir, idOf(7))).toEqual({ agentId: idOf(7), state: 'missing' });
    expect(statusText(agentStatus(dir, idOf(7)))).toContain('missing');
  });

  test('names the worktree directory and branch, and the fork source', () => {
    const worktree = { path: '/wt/a', cwd: '/wt/a/pkg', branch: 'pstack/a', base: 'HEAD', commit: 'abc' };
    const agentId = addAgent(1, { worktree, forkedFrom: idOf(9) });
    const status = agentStatus(dir, agentId);
    expect(status).toMatchObject({ directory: '/wt/a/pkg', branch: 'pstack/a', forkedFrom: idOf(9), model: "Pi's default model" });
    expect(status.updatedAt).toBeDefined();
    expect(statusText(status)).toContain('branch: pstack/a');
  });

  test('the last assistant text is the latest non-empty one, truncated to 500 characters', () => {
    const agentId = addAgent(1);
    const path = addTranscript(agentId, ['task', 'x'.repeat(800), 'more', '']);
    expect(lastAssistantText(path)).toBe(`${'x'.repeat(500)}…`);
  });
});

describe('agent_status: bounded transcript read (C-L3)', () => {
  const line = (entry: unknown) => `${JSON.stringify(entry)}\n`;
  const message = (role: string, text: string) => ({ type: 'message', message: { role, content: [{ type: 'text', text }] } });
  const header = { type: 'session', version: 3, id: idOf(1), cwd: '/w/app' };

  test('finds the last response behind a tool result larger than one read', () => {
    const path = join(dir, 'big.jsonl');
    writeFileSync(path, [line(header), line(message('assistant', 'early')), line(message('assistant', 'LAST-RESPONSE')), line(message('toolResult', 'x'.repeat(300_000)))].join(''));
    expect(lastAssistantText(path)).toBe('LAST-RESPONSE');
  });

  test('reads at most the transcript tail, so a response buried under megabytes of tool output is not shown', () => {
    const path = join(dir, 'huge.jsonl');
    writeFileSync(path, [line(header), line(message('assistant', 'BURIED')), line(message('toolResult', 'x'.repeat(5 * 1024 * 1024)))].join(''));
    expect({ last: lastAssistantText(path) }).toEqual({ last: undefined });
  });
});

describe('agent_status: listing', () => {
  test('lists agents newest first', () => {
    for (const n of [2, 5, 3]) addAgent(n);
    expect(listAgentStatuses(dir).agents.map((status) => status.agentId)).toEqual([idOf(5), idOf(3), idOf(2)]);
  });

  test('is bounded, reporting the total', () => {
    for (let n = 1; n <= 25; n += 1) addAgent(n);
    const { agents, total } = listAgentStatuses(dir);
    expect([agents.length, total, agents[0]?.agentId]).toEqual([20, 25, idOf(25)]);
    expect(listAgentStatuses(dir, 2).agents.map((status) => status.agentId)).toEqual([idOf(25), idOf(24)]);
  });

  test('skips a record without a creation time instead of failing the whole list (C-L3)', () => {
    addAgent(2);
    writeFileSync(join(dir, `${idOf(3)}.json`), JSON.stringify({ agentId: idOf(3), type: 'generalPurpose', readonly: false, cwd: '/w/app' }));
    expect(listAgentStatuses(dir)).toMatchObject({ agents: [{ agentId: idOf(2) }], total: 1 });
  });

  test('an empty or absent directory lists nothing', () => {
    expect(listAgentStatuses(join(dir, 'none'))).toEqual({ agents: [], total: 0 });
  });
});

describe('agent_status tool', () => {
  type Tool = { name: string; execute: (id: string, params: { agent_id?: string }, signal: undefined, onUpdate: undefined, ctx: { cwd: string }) => Promise<{ content: { text: string }[] }> };
  const register = () => {
    const tools: Tool[] = [];
    registerAgentStatus({ registerTool: (tool: Tool) => tools.push(tool) } as never);
    return tools[0] as Tool;
  };

  test('is annotated read-only and closed-world (C-L6)', () => {
    const tools: { annotations?: unknown }[] = [];
    registerAgentStatus({ registerTool: (tool: { annotations?: unknown }) => tools.push(tool) } as never);
    expect(tools[0]?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  test('reads the workspace subagent directory and never takes a run lock', async () => {
    const previous = process.env['PI_CODING_AGENT_DIR'];
    process.env['PI_CODING_AGENT_DIR'] = join(dir, 'agent');
    try {
      const tool = register();
      expect(tool.name).toBe('agent_status');
      const workspace = join(dir, 'w');
      expect((await tool.execute('t', {}, undefined, undefined, { cwd: workspace })).content[0]?.text).toBe('No subagents in this workspace yet.');
      dir = subagentDir(workspace);
      const agentId = addAgent(1);
      addTranscript(agentId, ['task', 'all done']);
      const text = (await tool.execute('t', { agent_id: agentId }, undefined, undefined, { cwd: workspace })).content[0]?.text ?? '';
      expect(text).toContain('state: idle');
      expect(text).toContain('all done');
      expect(listAgentStatuses(dir).agents[0]?.state).toBe('idle');
      await expect(tool.execute('t', { agent_id: '../x' }, undefined, undefined, { cwd: workspace })).rejects.toThrow('is not a valid agent ID');
    } finally {
      if (previous === undefined) delete process.env['PI_CODING_AGENT_DIR'];
      else process.env['PI_CODING_AGENT_DIR'] = previous;
    }
  });
});
