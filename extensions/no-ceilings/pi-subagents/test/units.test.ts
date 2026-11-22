import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BROWSER_SERVER_HINTS, loadSubagentsConfig, parseSubagentsConfig, subagentsConfigPaths } from '../src/config.ts';
import { computeAgentDirectories, discoverSubagents, parseContextWindow, parseSubagentFile, resolveSubagentDefinition, selectSubagentType } from '../src/discovery.ts';
import { buildSubagentsContextPrompt, formatDurationMs, formatElapsedCompact, formatSessionTitle, formatToolActivity, truncateByLines, truncateEnd, truncateOutputPreview } from '../src/formatters.ts';
import { formatAwaitResultText, formatTaskResultText } from '../src/tools.ts';
import { reduceSubagentEvent } from '../src/transcript.ts';
import { type AwaitSubagentDetails, MAX_NESTED_TASK_DEPTH, type SubagentSessionRecord, type TaskToolDetails, ZERO } from '../src/types.ts';
import { buildWorktreeNames, resolveWorktreeRoot, slugifyWorktreeLabel } from '../src/worktree.ts';
import { double, makeDefinition } from './harness.ts';

const ONE = 1;
const TWO = 2;
const THREE = 3;

function record(overrides: Partial<SubagentSessionRecord> = {}): SubagentSessionRecord {
  return {
    agentId: 'agent-1',
    parentSessionId: 'parent-1',
    toolCallId: 'call-1',
    subagentType: 'general-purpose',
    description: 'Test run',
    prompt: 'Do the work',
    readonly: false,
    status: 'running',
    isBackground: false,
    backgroundReason: 'unspecified',
    attempts: ONE,
    maxAttempts: ONE,
    toolCallCount: ZERO,
    startedAt: 1000,
    updatedAt: 1000,
    checkpoints: [],
    transcriptItems: [],
    ...overrides,
  };
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('config', () => {
  it('returns built-in defaults when no config file exists', () => {
    const cwd = tempDir('cfg-');
    const config = loadSubagentsConfig(cwd, join(cwd, 'agent'));
    expect(config.explore.enabled).toBe(true);
    expect(config.explore.model).toBe('default');
    expect(config.maxNestingDepth).toBe(MAX_NESTED_TASK_DEPTH);
    expect(config.browser.serverHints).toEqual([...DEFAULT_BROWSER_SERVER_HINTS]);
    expect(config.configFiles).toEqual([]);
    expect(config.errors).toEqual([]);
  });

  it('merges user and project config with project values winning', () => {
    const cwd = tempDir('cfg-');
    const agentDir = join(cwd, 'agent');
    mkdirSync(join(cwd, '.pi'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'subagents.json'), JSON.stringify({ explore: { model: 'fast', enabled: true }, retry: { maxAttempts: 3 }, worktrees: { branchPrefix: 'user-prefix' } }));
    writeFileSync(join(cwd, '.pi', 'subagents.json'), JSON.stringify({ explore: { model: 'inherit' }, retry: { maxAttempts: 2 } }));
    const config = loadSubagentsConfig(cwd, agentDir);
    expect(config.explore.model).toBe('inherit');
    expect(config.retry.maxAttempts).toBe(TWO);
    expect(config.retry.delayMs).toBe(250);
    expect(config.worktrees.branchPrefix).toBe('user-prefix');
    expect(config.configFiles).toEqual(subagentsConfigPaths(cwd, agentDir).user === config.configFiles[ZERO] ? [subagentsConfigPaths(cwd, agentDir).user, subagentsConfigPaths(cwd, agentDir).project] : config.configFiles);
  });

  it('reports a malformed file and keeps usable defaults', () => {
    const cwd = tempDir('cfg-');
    const agentDir = join(cwd, 'agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'subagents.json'), '{not json');
    const config = loadSubagentsConfig(cwd, agentDir);
    expect(config.errors.length).toBeGreaterThan(ZERO);
    expect(config.explore.model).toBe('default');
  });

  it('keeps valid sections when another section is invalid', () => {
    const parsed = parseSubagentsConfig({ explore: { model: 'inherit' }, worktrees: { branchPrefix: 'custom' }, retry: { maxAttempts: 99 } }, undefined, { cwd: '/tmp' });
    expect(parsed.config.explore.model).toBe('inherit');
    expect(parsed.config.worktrees.branchPrefix).toBe('custom');
    expect(parsed.config.retry.maxAttempts).toBe(1);
    expect(parsed.errors.some((error) => error.includes('retry.maxAttempts'))).toBe(true);
  });

  it('reports an invalid shape with a field path', () => {
    const parsed = parseSubagentsConfig({ nesting: { maxDepth: 99 }, explore: { model: 7 } }, undefined, { cwd: '/tmp' });
    expect(parsed.errors.some((error) => error.includes('nesting.maxDepth'))).toBe(true);
    expect(parsed.errors.some((error) => error.includes('explore.model'))).toBe(true);
    expect(parsed.config.maxNestingDepth).toBe(MAX_NESTED_TASK_DEPTH);
  });

  it('lets CLI flags override the file and clamps the depth', () => {
    const parsed = parseSubagentsConfig({ explore: { model: 'fast' } }, undefined, { cwd: '/tmp', flags: { exploreModel: 'opus', maxNestingDepth: '9' } });
    expect(parsed.config.explore.model).toBe('opus');
    expect(parsed.config.maxNestingDepth).toBe(5);
    const ignored = parseSubagentsConfig(undefined, undefined, { cwd: '/tmp', flags: { maxNestingDepth: 'not-a-number' } });
    expect(ignored.config.maxNestingDepth).toBe(MAX_NESTED_TASK_DEPTH);
  });

  it('resolves relative configured agent directories against the workspace', () => {
    const parsed = parseSubagentsConfig({ agents: { directories: ['tools/agents', '/abs/agents'], disabled: ['shell'] } }, undefined, { cwd: '/work/repo' });
    expect(parsed.config.extraAgentDirectories).toEqual(['/work/repo/tools/agents', '/abs/agents']);
    expect(parsed.config.disabledAgents).toEqual(['shell']);
  });
});

describe('discovery helpers', () => {
  it('parses context window strings and numbers', () => {
    expect(parseContextWindow('200k')).toBe(200_000);
    expect(parseContextWindow('1M')).toBe(1_000_000);
    expect(parseContextWindow('32000')).toBe(32_000);
    expect(parseContextWindow(4096)).toBe(4096);
    expect(parseContextWindow('nope')).toBeUndefined();
    expect(parseContextWindow(-1)).toBeUndefined();
  });

  it('loads project agents only for trusted projects', () => {
    const home = tempDir('trust-home-');
    const agentDir = tempDir('trust-agent-');
    const cwd = tempDir('trust-cwd-');
    mkdirSync(join(cwd, '.pi/agents'), { recursive: true });
    mkdirSync(join(home, '.claude/agents'), { recursive: true });
    writeFileSync(join(cwd, '.pi/agents/project.md'), ['---', 'name: project-agent', 'description: Project', '---', 'Body'].join('\n'));
    writeFileSync(join(home, '.claude/agents/user.md'), ['---', 'name: user-agent', 'description: User', '---', 'Body'].join('\n'));
    const untrusted = discoverSubagents(cwd, { homeDir: home, agentDir, projectTrusted: false });
    expect(untrusted.some((definition) => definition.name === 'project-agent')).toBe(false);
    expect(untrusted.some((definition) => definition.name === 'user-agent')).toBe(true);
    const trusted = discoverSubagents(cwd, { homeDir: home, agentDir, projectTrusted: true });
    expect(trusted.some((definition) => definition.name === 'project-agent')).toBe(true);
  });

  it('ignores the project config file when the project is untrusted', () => {
    const cwd = tempDir('trust-cfg-');
    mkdirSync(join(cwd, '.pi'), { recursive: true });
    writeFileSync(join(cwd, '.pi', 'subagents.json'), JSON.stringify({ explore: { model: 'inherit' } }));
    const config = loadSubagentsConfig(cwd, join(cwd, 'agent'), undefined, false);
    expect(config.explore.model).toBe('default');
    expect(config.configFiles).toEqual([]);
  });

  it('skips agent files without frontmatter or without a body', () => {
    const cwd = tempDir('disc-');
    mkdirSync(join(cwd, 'agents'), { recursive: true });
    writeFileSync(join(cwd, 'agents', 'no-frontmatter.md'), '# Just a heading\n');
    writeFileSync(join(cwd, 'agents', 'empty-body.md'), ['---', 'name: empty', '---', '   '].join('\n'));
    writeFileSync(join(cwd, 'agents', 'malformed.md'), ['---', 'name: [unclosed', '---', 'body'].join('\n'));
    writeFileSync(join(cwd, 'agents', 'good.md'), ['---', 'name: good', 'description: Works', 'disabled: true', '---', 'Body'].join('\n'));
    expect(parseSubagentFile(join(cwd, 'agents', 'no-frontmatter.md'), 'workspace')).toBeUndefined();
    expect(parseSubagentFile(join(cwd, 'agents', 'empty-body.md'), 'workspace')).toBeUndefined();
    expect(parseSubagentFile(join(cwd, 'agents', 'malformed.md'), 'workspace')).toBeUndefined();
    expect(parseSubagentFile(join(cwd, 'agents', 'good.md'), 'workspace')?.enabled).toBe(false);
    expect(parseSubagentFile(join(cwd, 'agents', 'missing.md'), 'workspace')).toBeUndefined();
  });

  it('lists workspace, claude, codex, user, and configured directories in order', () => {
    const dirs = computeAgentDirectories('/repo', '/home/u', '/home/u/.pi/agent', { extraAgentDirectories: ['/extra'] } as never);
    expect(dirs.map((entry) => entry.source)).toEqual(['workspace', 'claude-workspace', 'codex-workspace', 'shared-workspace', 'user', 'claude-user', 'codex-user', 'shared-user', 'configured']);
  });

  it('resolves a name case-insensitively and defaults to general-purpose', () => {
    const definitions = [makeDefinition({ name: 'reviewer' }), makeDefinition({ name: 'general-purpose' })];
    expect(resolveSubagentDefinition(definitions, 'Reviewer')?.name).toBe('reviewer');
    expect(resolveSubagentDefinition(definitions, undefined)?.name).toBe('general-purpose');
    expect(selectSubagentType(definitions, { subagentType: 'reviewer', description: '', prompt: '' })).toBe('reviewer');
    expect(selectSubagentType(definitions, { description: 'unrelated words only', prompt: '' })).toBe('general-purpose');
  });
});

describe('formatters', () => {
  it('formats durations across every scale', () => {
    expect(formatDurationMs(undefined)).toBeUndefined();
    expect(formatDurationMs(-ONE)).toBeUndefined();
    expect(formatDurationMs(250)).toBe('250ms');
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(61_000)).toBe('1m 1s');
    expect(formatDurationMs(120_000)).toBe('2m');
    expect(formatDurationMs(3_600_000)).toBe('1h');
    expect(formatDurationMs(3_660_000)).toBe('1h 1m');
  });

  it('formats elapsed time from seconds to days', () => {
    expect(formatElapsedCompact(500)).toBe('0s');
    expect(formatElapsedCompact(65_000)).toBe('1m 5s');
    expect(formatElapsedCompact(3_600_000)).toBe('1h');
    expect(formatElapsedCompact(90_061_000)).toBe('1d 1h 1m 1s');
  });

  it('truncates text, lines, and output previews', () => {
    expect(truncateEnd('abcdef', 3)).toBe('ab…');
    expect(truncateEnd('abc', 0)).toBe('');
    expect(truncateEnd('abc', 3)).toBe('abc');
    expect(truncateByLines('a\nb\nc', TWO)).toEqual({ text: 'a\nb…', wasTruncated: true });
    expect(truncateByLines('a\nb', TWO)).toEqual({ text: 'a\nb', wasTruncated: false });
    const preview = truncateOutputPreview('x'.repeat(700));
    expect(preview.wasTruncated).toBe(true);
    expect(preview.text.length).toBeLessThan(700);
  });

  it('describes tool activity for every known tool and a fallback', () => {
    expect(formatToolActivity('read', { path: '/a/b/index.ts' }).stepLabel).toBe('Reading index.ts');
    expect(formatToolActivity('edit', { file_path: '/a/b/c.ts' }).verb).toBe('Editing');
    expect(formatToolActivity('write', {}).stepLabel).toBe('Writing file');
    expect(formatToolActivity('delete', {}).verb).toBe('Deleting');
    expect(formatToolActivity('ls', {}).stepLabel).toBe('Listing directory');
    expect(formatToolActivity('grep', { pattern: 'needle' }).stepLabel).toBe('Searching "needle"');
    expect(formatToolActivity('find', { globPattern: '**/*.ts' }).stepLabel).toContain('Finding');
    expect(formatToolActivity('glob', {}).stepLabel).toBe('Finding files');
    expect(formatToolActivity('bash', { command: 'ls -la' }).stepLabel).toBe('Running: ls -la');
    expect(formatToolActivity('shell', {}).stepLabel).toBe('Running command');
    expect(formatToolActivity('task', { description: 'Sub work' }).stepLabel).toBe('Running subagent');
    expect(formatToolActivity('mystery', {}).stepLabel).toBe('Working…');
  });

  it('builds titles and summaries', () => {
    expect(formatSessionTitle('  ', 'prompt text', 'abcdef123456')).toBe('prompt text');
    expect(formatSessionTitle('', '', 'abcdef123456')).toBe('Subagent abcdef12');
  });

  it('lists subagents and nesting depth in the context prompt', () => {
    const prompt = buildSubagentsContextPrompt([makeDefinition({ name: 'explore', description: '', permissionMode: 'readonly', worktree: true, mcp: true, thinking: 'high', model: 'fast', source: 'workspace' })], { maxNestingDepth: TWO });
    expect(prompt).toContain('`explore`');
    expect(prompt).toContain('readonly');
    expect(prompt).toContain('isolated-worktree');
    expect(prompt).toContain('thinking=high');
    expect(prompt).toContain('at most 2 level(s) deep');
    expect(prompt).toContain('Custom subagent (workspace)');
  });
});

describe('tool result text', () => {
  const base: TaskToolDetails = {
    agentId: 'agent-1',
    description: 'Work',
    subagentType: 'general-purpose',
    readonly: false,
    status: 'success',
    isBackground: false,
    backgroundReason: 'unspecified',
    attempts: ONE,
    maxAttempts: ONE,
    toolCallCount: TWO,
    checkpoints: THREE,
    finalMessage: 'All done',
  };

  it('reports background launches with paths to follow', () => {
    const text = formatTaskResultText({ ...base, status: 'running', isBackground: true, transcriptPath: '/tmp/t.jsonl', worktreePath: '/tmp/wt', branch: 'pi-subagents/x' });
    expect(text).toContain('launched in background');
    expect(text).toContain('transcript_path: /tmp/t.jsonl');
    expect(text).toContain('worktree_path: /tmp/wt');
  });

  it('reports failures with the failure identifier and attempt count', () => {
    const text = formatTaskResultText({ ...base, status: 'error', error: 'boom', errorCode: 'failed', failureId: 'abc123', attempts: TWO, maxAttempts: THREE });
    expect(text).toContain('failure_id: abc123');
    expect(text).toContain('code: failed');
    expect(text).toContain('attempts: 2/3');
  });

  it('reports success with checkpoints and worktree details', () => {
    const text = formatTaskResultText({ ...base, branch: 'pi-subagents/x', worktreePath: '/tmp/wt', worktreeSummary: '1 file changed' });
    expect(text).toContain('checkpoints: 3');
    expect(text).toContain('1 file changed');
    expect(text).toContain('branch: pi-subagents/x');
  });

  it('reports await outcomes', () => {
    const complete: AwaitSubagentDetails = { agentId: 'a', outcome: 'complete', status: 'success', finalMessage: 'done' };
    expect(formatAwaitResultText(complete)).toContain('finished with status success');
    expect(formatAwaitResultText({ agentId: 'a', outcome: 'still_running', transcriptPath: '/tmp/t' })).toContain('still running');
    expect(formatAwaitResultText({ agentId: 'a', outcome: 'not_found', error: 'missing' })).toBe('missing');
  });
});

describe('transcript reducer', () => {
  const base = record();

  it('streams text and thinking without touching the transcript', () => {
    const text = reduceSubagentEvent(base, double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta: 'hi' } }), { toolCallCount: ZERO, finalMessage: undefined }, 1);
    expect(text.record.streamingText).toBe('hi');
    expect(text.record.transcriptItems).toEqual([]);
    const thinking = reduceSubagentEvent(base, double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' } }), { toolCallCount: ZERO, finalMessage: undefined }, 2);
    expect(thinking.record.streamingThinking).toBe('hmm');
    const other = reduceSubagentEvent(base, double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_start' } }), { toolCallCount: ZERO, finalMessage: undefined }, 3);
    expect(other.record.streamingText).toBeUndefined();
  });

  it('ignores non-assistant messages and empty assistant text', () => {
    const user = reduceSubagentEvent(base, double<AgentSessionEvent>({ type: 'message_end', message: { role: 'user', content: 'hello' } }), { toolCallCount: ZERO, finalMessage: undefined }, 1);
    expect(user.record.transcriptItems).toEqual([]);
    const empty = reduceSubagentEvent(base, double<AgentSessionEvent>({ type: 'message_end', message: { role: 'assistant', content: '   ' } }), { toolCallCount: ZERO, finalMessage: undefined }, 1);
    expect(empty.record.transcriptItems).toEqual([]);
  });

  it('records tool start and end with arguments, output, and an error flag', () => {
    const started = reduceSubagentEvent(base, double<AgentSessionEvent>({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'a.ts' } }), { toolCallCount: ZERO, finalMessage: undefined }, 1);
    expect(started.record.transcriptItems[ZERO]?.role).toBe('tool');
    expect(started.record.currentStep).toBe('Reading a.ts');
    const ended = reduceSubagentEvent(
      started.record,
      double<AgentSessionEvent>({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: { content: [{ type: 'text', text: 'file body' }] }, isError: true }),
      started.progress,
      2,
    );
    expect(ended.progress.toolCallCount).toBe(ONE);
    expect(ended.checkpoint).toBe(true);
    expect(ended.record.transcriptItems[ONE]?.role).toBe('result');
    expect(ended.record.transcriptItems[ONE]?.isError).toBe(true);
    expect(ended.record.activeToolVerb).toBeUndefined();
  });

  it('handles anonymous tool results and turn boundaries', () => {
    const started = reduceSubagentEvent(base, double<AgentSessionEvent>({ type: 'tool_execution_start', toolCallId: 't2', toolName: 'mystery', args: 'not-an-object' }), { toolCallCount: ZERO, finalMessage: undefined }, 1);
    const ended = reduceSubagentEvent(started.record, double<AgentSessionEvent>({ type: 'tool_execution_end', toolCallId: 't2', toolName: 'mystery', result: {}, isError: false }), started.progress, 2);
    expect(ended.record.transcriptItems.length).toBe(ONE);
    const turn = reduceSubagentEvent(ended.record, double<AgentSessionEvent>({ type: 'turn_end', message: {}, toolResults: [] }), ended.progress, 3);
    expect(turn.checkpoint).toBe(true);
    const unknown = reduceSubagentEvent(turn.record, double<AgentSessionEvent>({ type: 'agent_start' }), turn.progress, 4);
    expect(unknown.checkpoint).toBe(false);
    expect(unknown.record).toBe(turn.record);
  });
});

describe('worktree helpers', () => {
  it('slugifies descriptions and falls back when empty', () => {
    expect(slugifyWorktreeLabel('Refactor the parser')).toBe('refactor-the-parser');
    expect(slugifyWorktreeLabel('   !!!   ')).toBe('subagent');
    expect(slugifyWorktreeLabel('a'.repeat(60)).length).toBe(24);
  });

  it('builds a branch from the prefix, slug, and suffix', () => {
    const names = buildWorktreeNames('Fix bug', 'ab12', 'pi-subagents');
    expect(names.slug).toBe('fix-bug-ab1');
    expect(names.branch).toBe('pi-subagents/fix-bug-ab1');
  });

  it('prefers the configured root, then the session dir, then the temp dir', () => {
    expect(resolveWorktreeRoot({ root: '/root', sessionDir: '/sessions' })).toBe('/root');
    expect(resolveWorktreeRoot({ root: undefined, sessionDir: '/sessions' })).toBe('/sessions/worktrees');
    expect(resolveWorktreeRoot({ root: undefined, sessionDir: '  ' })).toContain('pi-subagents-worktrees');
  });
});
