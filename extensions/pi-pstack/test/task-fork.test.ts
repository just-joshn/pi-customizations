import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ExtensionContext, SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { subagentDir } from '../src/paths.ts';
import { type AgentDefinition, GENERAL_PURPOSE } from '../src/task/agents.ts';
import { type AgentRecord, acquireRunLock, forkTranscript, transcriptFor, writeRecord } from '../src/task/records.ts';
import { planFork, prepareFork, taskPreflight } from '../src/task/tool.ts';
import type { Worktree } from '../src/task/worktree.ts';

const source = '11111111-2222-4333-8444-555555555555';
const forkId = '99999999-2222-4333-8444-555555555555';
const reviewer: AgentDefinition = { type: 'reviewer', description: 'r', readonly: true, background: false, prompt: '' };
const agents = [GENERAL_PURPOSE, reviewer];
const notRunning = () => false;

let root = '';
let workspace = '';
let dir = '';
let previousAgentDir: string | undefined;

const ctx = () =>
  ({ cwd: workspace, model: undefined, thinkingLevel: undefined, modelRegistry: { getAvailable: () => [] }, sessionManager: { getSessionId: () => 'parent-session' }, isProjectTrusted: () => true }) as unknown as ExtensionContext;
const params = (extra: Record<string, unknown> = {}) => ({ description: 'fork it', prompt: 'next task', fork: source, ...extra });

function writeTranscript(agentId: string, cwd: string): string {
  const header = { type: 'session', version: 3, id: agentId, timestamp: '2026-10-28T10:00:00.000Z', cwd };
  const user = { type: 'message', id: 'e1', parentId: null, timestamp: '2026-10-28T10:00:01.000Z', message: { role: 'user', content: 'first task', timestamp: 1 } };
  const assistant = { type: 'message', id: 'e2', parentId: 'e1', timestamp: '2026-10-28T10:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'built it' }], timestamp: 2 } };
  const path = join(dir, `2026-10-28T10-00-00-000Z_${agentId}.jsonl`);
  writeFileSync(path, `${[header, user, assistant].map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return path;
}

function writeSource(extra: Partial<AgentRecord> = {}, runCwd: string = workspace): string {
  writeRecord(dir, { agentId: source, type: 'generalPurpose', readonly: false, cwd: workspace, createdAt: '2026-10-28T10:00:00.000Z', depth: 1, model: { provider: 'p', id: 'm', thinking: 'high' }, ...extra });
  return writeTranscript(source, runCwd);
}

const lines = (path: string) =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'fork-')));
  workspace = join(root, 'workspace');
  mkdirSync(workspace);
  previousAgentDir = process.env['PI_CODING_AGENT_DIR'];
  process.env['PI_CODING_AGENT_DIR'] = join(root, 'agent');
  dir = subagentDir(workspace);
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  if (previousAgentDir === undefined) delete process.env['PI_CODING_AGENT_DIR'];
  else process.env['PI_CODING_AGENT_DIR'] = previousAgentDir;
  rmSync(root, { recursive: true, force: true });
});

describe('Task fork preflight', () => {
  test('refuses fork with resume', () => {
    expect(() => taskPreflight(params({ resume: source }), 0)).toThrow('fork and resume cannot be combined');
  });

  test.for([{ environment: 'cloud' as const }, { environment: 'local' as const }, { environment: 'cloud' as const, cloud_base_branch: 'main' }])('refuses fork with %j: the fork runs where the source ran', (extra) => {
    expect(() => taskPreflight(params(extra), 0)).toThrow('fork runs where the source agent ran, so it takes no environment or cloud_base_branch.');
  });

  test('refuses fork_turns without fork (fork from a turn)', () => {
    expect(() => taskPreflight({ description: 'd', prompt: 'p', fork_turns: 1 }, 0)).toThrow('fork_turns needs fork: it says how many user turns of the source agent to copy.');
  });

  test('refuses a fork from a grandchild, as resume does', () => {
    expect(() => taskPreflight(params(), 2)).toThrow('cannot launch further subagents');
  });
});

describe('planFork', () => {
  test('a new agent ID that starts from the source record: type, model, readonly, directory, depth', () => {
    writeSource();
    const plan = planFork(params(), ctx(), agents, notRunning, 0, forkId);
    expect(plan).toMatchObject({ kind: 'fork', agentId: forkId, forkedFrom: source, model: { provider: 'p', id: 'm', thinking: 'high' }, readonly: false, workspace, worktree: undefined, depth: 1 });
    expect(plan.agent.type).toBe('generalPurpose');
    expect(plan.notes).toEqual([`Forked from agent ${source}.`]);
  });

  test("runs in the source's worktree and records the same branch", () => {
    const tree = join(root, 'worktrees', source);
    mkdirSync(tree, { recursive: true });
    const worktree: Worktree = { path: tree, cwd: tree, branch: `pstack/${source}`, base: 'HEAD', commit: 'abc' };
    writeSource({ worktree }, tree);
    const plan = planFork(params(), ctx(), agents, notRunning, 0, forkId);
    expect(plan.worktree).toEqual(worktree);
    expect(plan.workspace).toBe(workspace);
  });

  test('readonly can be added but never lifted', () => {
    writeSource({ readonly: true });
    expect(planFork(params({ readonly: false }), ctx(), agents, notRunning, 0, forkId).readonly).toBe(true);
    writeSource({ readonly: false });
    expect(planFork(params({ readonly: true }), ctx(), agents, notRunning, 0, forkId).readonly).toBe(true);
    expect(planFork(params({ subagent_type: 'generalPurpose', readonly: false }), ctx(), agents, notRunning, 0, forkId).readonly).toBe(false);
  });

  test('a readonly source type keeps the fork readonly even under another type', () => {
    writeSource({ type: 'reviewer', readonly: false });
    expect(planFork(params({ subagent_type: 'generalPurpose' }), ctx(), agents, notRunning, 0, forkId).readonly).toBe(true);
  });

  test('keeps the deeper of the source depth and the caller depth', () => {
    writeSource({ depth: 2 });
    expect(planFork(params(), ctx(), agents, notRunning, 0, forkId).depth).toBe(2);
  });

  test('refuses while the source is running in this runtime', () => {
    writeSource();
    expect(() => planFork(params(), ctx(), agents, (id) => id === source, 0, forkId)).toThrow(`Agent ${source} is still running.`);
  });

  test('refuses an unknown source like resume does', () => {
    expect(() => planFork(params(), ctx(), agents, notRunning, 0, forkId)).toThrow(`Unknown agent ID ${source}.`);
  });

  test('refuses a source without a transcript', () => {
    writeRecord(dir, { agentId: source, type: 'generalPurpose', readonly: false, cwd: workspace, createdAt: '2026-10-28T10:00:00.000Z' });
    expect(() => planFork(params(), ctx(), agents, notRunning, 0, forkId)).toThrow('has no transcript to fork');
  });
});

describe('forkTranscript', () => {
  test('copies the source session under the new ID, with the source as its parent and unchanged', () => {
    const tree = join(root, 'tree');
    const sourcePath = writeSource({}, tree);
    const before = readFileSync(sourcePath, 'utf8');
    const copy = forkTranscript(dir, source, forkId);
    expect(copy).toBe(transcriptFor(dir, forkId));
    expect(copy.endsWith(`_${forkId}.jsonl`)).toBe(true);
    const [header, ...entries] = lines(copy);
    expect(header).toMatchObject({ type: 'session', id: forkId, cwd: tree, parentSession: sourcePath });
    expect(entries).toEqual(lines(sourcePath).slice(1));
    expect(readFileSync(sourcePath, 'utf8')).toBe(before);
    // What `pi --session-id <fork> --session-dir <dir>` run in the source's directory opens.
    expect(SessionManager.findById(tree, forkId, dir)).toBe(copy);
    expect(SessionManager.findById(tree, source, dir)).toBe(sourcePath);
  });
});

describe('forkTranscript: fork_turns', () => {
  function writeTurns(turns: number): string {
    const header = { type: 'session', version: 3, id: source, timestamp: '2026-10-28T10:00:00.000Z', cwd: workspace };
    const entries = Array.from({ length: turns }, (_, turn) => [
      { type: 'message', id: `u${turn}`, parentId: turn === 0 ? null : `a${turn - 1}`, timestamp: '2026-10-28T10:00:01.000Z', message: { role: 'user', content: `task ${turn}`, timestamp: 1 } },
      { type: 'message', id: `a${turn}`, parentId: `u${turn}`, timestamp: '2026-10-28T10:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: `done ${turn}` }], timestamp: 2 } },
    ]).flat();
    const path = join(dir, `2026-10-28T10-00-00-000Z_${source}.jsonl`);
    writeFileSync(path, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return path;
  }
  const userTexts = (path: string) =>
    SessionManager.open(path)
      .buildSessionContext()
      .messages.filter((message) => message.role === 'user')
      .map((message) => message.content);

  test('copies only the first N user turns, and the copy opens at the end of turn N', () => {
    const sourcePath = writeTurns(3);
    const copy = forkTranscript(dir, source, forkId, 2);
    expect(
      lines(copy)
        .slice(1)
        .map((entry) => entry['id']),
    ).toEqual(['u0', 'a0', 'u1', 'a1']);
    expect(userTexts(copy)).toEqual(['task 0', 'task 1']);
    expect(userTexts(sourcePath)).toEqual(['task 0', 'task 1', 'task 2']);
  });

  test('a turn count past the end copies the whole transcript', () => {
    writeTurns(2);
    expect(userTexts(forkTranscript(dir, source, forkId, 5))).toEqual(['task 0', 'task 1']);
  });

  test('prepareFork applies fork_turns and names it in the notes', () => {
    writeSource();
    writeTurns(3);
    const { plan, lock } = prepareFork(params({ fork_turns: 1 }), ctx(), { agents, depth: 0 }, notRunning);
    expect(userTexts(transcriptFor(dir, plan.agentId) ?? '')).toEqual(['task 0']);
    expect(plan.notes[0]).toBe(`Forked from agent ${source}, keeping its first 1 user turn.`);
    lock.release();
  });
});

describe('prepareFork: plan mode', () => {
  test('forks in plan mode, marking the launch for plan mode while the record keeps the source readonly (C-H3, C-M1)', () => {
    writeSource();
    const { plan, lock } = prepareFork(params(), ctx(), { agents, depth: 0, planMode: () => true }, notRunning);
    expect([plan.planMode, plan.readonly, plan.worktree]).toEqual([true, false, undefined]);
    lock.release();
  });

  test("a plan-mode fork of an isolated worker runs readonly in that worker's worktree", () => {
    const tree = join(root, 'worktrees', source);
    mkdirSync(tree, { recursive: true });
    const worktree: Worktree = { path: tree, cwd: tree, branch: `pstack/${source}`, base: 'HEAD', commit: 'abc' };
    writeSource({ worktree }, tree);
    const { plan, lock } = prepareFork(params(), ctx(), { agents, depth: 0, planMode: () => true }, notRunning);
    expect([plan.planMode, plan.readonly, plan.worktree]).toEqual([true, false, worktree]);
    lock.release();
  });
});

describe('prepareFork: run locks', () => {
  test('copies the transcript, holds the new agent lock, and leaves the source unlocked', () => {
    writeSource();
    const { plan, lock } = prepareFork(params(), ctx(), { agents, depth: 0 }, notRunning);
    expect(plan.agentId).not.toBe(source);
    expect(transcriptFor(dir, plan.agentId)).toBeDefined();
    expect(existsSync(join(dir, `${plan.agentId}.lock`))).toBe(true);
    expect(existsSync(join(dir, `${source}.lock`))).toBe(false);
    lock.release();
  });

  test('refuses while another process holds the source run lock, copying nothing', () => {
    writeSource();
    const held = acquireRunLock(dir, source);
    expect(() => prepareFork(params(), ctx(), { agents, depth: 0 }, notRunning)).toThrow(`Agent ${source} is still running. Wait for its completion before forking it.`);
    held.release();
    const leftovers = readdirSync(dir).filter((name) => name.endsWith('.jsonl') || name.endsWith('.lock'));
    expect(leftovers).toEqual([`2026-10-28T10-00-00-000Z_${source}.jsonl`]);
  });
});
