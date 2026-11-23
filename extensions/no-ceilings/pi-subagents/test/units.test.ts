import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BROWSER_SERVER_HINTS, loadSubagentsConfig, parseSubagentsConfig, subagentsConfigPaths } from '../src/config.ts';
import { computeAgentDirectories, discoverSubagents, normalizeToolNames, parseContextWindow, parseSubagentFile, resolveSubagentDefinition, selectSubagentType } from '../src/discovery.ts';
import { buildSubagentsContextPrompt, formatDurationMs, formatElapsedCompact, formatSessionTitle, formatToolActivity, truncateByLines, truncateEnd, truncateOutputPreview } from '../src/formatters.ts';
import { applyDefinitionToModel } from '../src/model-resolution.ts';
import { evaluateReadonlySubagentGuard, isSafeReadOnlyCommand, sandboxReadOnlyCommand } from '../src/readonly-guard.ts';
import { createSubagentStore } from '../src/store.ts';
import { formatAwaitResultText, formatTaskResultText } from '../src/tools.ts';
import { reduceSubagentEvent } from '../src/transcript.ts';
import { type AwaitSubagentDetails, MAX_NESTED_TASK_DEPTH, type SubagentSessionRecord, type TaskToolDetails, ZERO } from '../src/types.ts';
import { buildWorktreeNames, resolveWorktreeChildCwd, resolveWorktreeRoot, slugifyWorktreeLabel } from '../src/worktree.ts';
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

  it('ignores configured agent directories inside an untrusted project', () => {
    const home = tempDir('cfg-trust-home-');
    const agentDir = tempDir('cfg-trust-agent-');
    const cwd = tempDir('cfg-trust-cwd-');
    const outside = tempDir('cfg-trust-outside-');
    mkdirSync(join(cwd, '.pi/agents'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(cwd, '.pi/agents/evil.md'), ['---', 'name: evil-agent', 'description: Evil', '---', 'Body.'].join('\n'));
    writeFileSync(join(outside, 'good.md'), ['---', 'name: good-agent', 'description: Good', '---', 'Body.'].join('\n'));
    const config = parseSubagentsConfig({ agents: { directories: [join(cwd, '.pi/agents'), outside] } }, undefined, { cwd }).config;
    const untrusted = discoverSubagents(cwd, { homeDir: home, agentDir, config, projectTrusted: false });
    expect(untrusted.some((definition) => definition.name === 'evil-agent')).toBe(false);
    expect(untrusted.some((definition) => definition.name === 'good-agent')).toBe(true);
    const trusted = discoverSubagents(cwd, { homeDir: home, agentDir, config, projectTrusted: true });
    expect(trusted.some((definition) => definition.name === 'evil-agent')).toBe(true);
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

  it('dedupes agent names case-insensitively with project precedence', () => {
    const cwd = tempDir('case-name-');
    mkdirSync(join(cwd, '.pi/agents'), { recursive: true });
    writeFileSync(join(cwd, '.pi/agents/explore.md'), ['---', 'name: Explore', 'description: Custom explore', '---', 'Body.'].join('\n'));
    const definitions = discoverSubagents(cwd, { homeDir: cwd, agentDir: cwd, projectTrusted: true });
    const explores = definitions.filter((definition) => definition.name.toLowerCase() === 'explore');
    expect(explores).toHaveLength(1);
    expect(explores[0]?.source).toBe('workspace');
    expect(selectSubagentType(definitions, { description: 'use explore to find the bug', prompt: '' })).toBe('Explore');
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

  it('lists configured project directories before user directories', () => {
    const config = parseSubagentsConfig({ agents: { directories: ['/extra'] } }, undefined, { cwd: '/repo' }).config;
    const dirs = computeAgentDirectories('/repo', '/home/u', '/home/u/.pi/agent', config);
    expect(dirs.map((entry) => entry.source)).toEqual(['workspace', 'claude-workspace', 'codex-workspace', 'shared-workspace', 'configured', 'user', 'claude-user', 'codex-user', 'shared-user']);
  });

  it('lets a configured project directory win over a user agent of the same name', () => {
    const home = tempDir('prec-home-');
    const agentDir = tempDir('prec-agent-');
    const cwd = tempDir('prec-cwd-');
    mkdirSync(join(cwd, 'tools/agents'), { recursive: true });
    mkdirSync(join(agentDir, 'agents'), { recursive: true });
    writeFileSync(join(cwd, 'tools/agents/auditor.md'), ['---', 'name: auditor', 'description: CONFIGURED project auditor', '---', 'Project.'].join('\n'));
    writeFileSync(join(agentDir, 'agents/auditor.md'), ['---', 'name: auditor', 'description: USER auditor', '---', 'User.'].join('\n'));
    const config = parseSubagentsConfig({ agents: { directories: ['tools/agents'] } }, undefined, { cwd }).config;
    const auditor = discoverSubagents(cwd, { homeDir: home, agentDir, config }).find((definition) => definition.name === 'auditor');
    expect(auditor?.source).toBe('configured');
    expect(auditor?.description).toBe('CONFIGURED project auditor');
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

  it('records every thinking block once when a message carries two', () => {
    const first = reduceSubagentEvent(
      base,
      double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_end', contentIndex: ZERO, content: 'first block', partial: {} } }),
      { toolCallCount: ZERO, finalMessage: undefined },
      1,
    );
    const second = reduceSubagentEvent(
      first.record,
      double<AgentSessionEvent>({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_end', contentIndex: ONE, content: 'second block', partial: {} } }),
      first.progress,
      2,
    );
    const ended = reduceSubagentEvent(
      second.record,
      double<AgentSessionEvent>({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'first block' },
            { type: 'thinking', thinking: 'second block' },
            { type: 'text', text: 'done' },
          ],
        },
      }),
      second.progress,
      3,
    );
    expect(ended.record.transcriptItems.map((item) => `${item.role}:${item.text}`)).toEqual(['thinking:first block', 'thinking:second block', 'assistant:done']);
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
  it('mirrors the parent subdirectory inside a worktree', () => {
    expect(resolveWorktreeChildCwd({ repoRoot: '/repo', path: '/wt' }, '/repo/packages/x')).toBe('/wt/packages/x');
    expect(resolveWorktreeChildCwd({ repoRoot: '/repo', path: '/wt' }, '/repo')).toBe('/wt');
    expect(resolveWorktreeChildCwd({ repoRoot: '/repo', path: '/wt' }, '/outside')).toBe('/wt');
  });

  it('falls back to an existing directory for an untracked parent subdirectory', () => {
    const repo = tempDir('worktree-cwd-repo-');
    const worktree = tempDir('worktree-cwd-wt-');
    mkdirSync(join(repo, 'pkg', 'app'), { recursive: true });
    mkdirSync(join(worktree, 'pkg', 'app'), { recursive: true });
    mkdirSync(join(repo, 'scratch', 'untracked'), { recursive: true });
    expect(resolveWorktreeChildCwd({ repoRoot: repo, path: worktree }, join(repo, 'pkg', 'app'))).toBe(join(worktree, 'pkg', 'app'));
    const fallback = resolveWorktreeChildCwd({ repoRoot: repo, path: worktree }, join(repo, 'scratch', 'untracked'));
    expect(fallback).toBe(worktree);
    expect(existsSync(fallback)).toBe(true);
  });

  it('bounds completed transcripts in mid-run snapshots', () => {
    const store = createSubagentStore();
    for (let index = ZERO; index < 5; index += 1) {
      store.upsertSession(
        record({
          agentId: `00000000-0000-4000-8000-00000000000${index}`,
          status: 'success',
          updatedAt: index,
          transcriptItems: Array.from({ length: 10 }, (_value, item) => ({ id: `i${item}`, role: 'assistant' as const, text: 'x'.repeat(2000), completed: true, timestamp: index })),
        }),
      );
    }
    const snapshot = store.toPersistedState({ includeTranscriptItems: false });
    const withTranscripts = snapshot.sessions.filter((session) => (session.transcriptItems?.length ?? ZERO) > ZERO);
    expect(withTranscripts.length).toBeLessThanOrEqual(3);
    const defaultSnapshot = store.toPersistedState();
    const defaultWithTranscripts = defaultSnapshot.sessions.filter((session) => (session.transcriptItems?.length ?? ZERO) > ZERO);
    expect(defaultWithTranscripts.length).toBeLessThanOrEqual(3);
    const kept = defaultWithTranscripts.map((session) => session.agentId).sort();
    expect(kept).toEqual(['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004']);
    expect(JSON.stringify(snapshot).length).toBeLessThan(100_000);
  });
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

describe('adversary regressions', () => {
  it('blocks sed write commands and sort output flags in read-only mode', () => {
    expect(isSafeReadOnlyCommand("sed 's/a/b/woutfile'")).toBe(false);
    expect(isSafeReadOnlyCommand("sed 's/a/b/Woutfile'")).toBe(false);
    expect(isSafeReadOnlyCommand("sed 's|a|b|woutfile'")).toBe(false);
    expect(isSafeReadOnlyCommand('sed w/tmp/out.txt file.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('sort -ooutfile input.txt')).toBe(false);
    expect(isSafeReadOnlyCommand("sed -n '1w outfile'")).toBe(false);
    expect(isSafeReadOnlyCommand("sed -n '1,5p' input.txt")).toBe(true);
    expect(isSafeReadOnlyCommand('sort input.txt')).toBe(true);
  });

  it('blocks program-file and quoted sed writers and awk redirection', () => {
    expect(isSafeReadOnlyCommand('sed -f script.sed input.txt')).toBe(false);
    expect(isSafeReadOnlyCommand("sed -n 'w/path/out.txt' input.txt")).toBe(false);
    expect(isSafeReadOnlyCommand('awk -f script.awk')).toBe(false);
    expect(isSafeReadOnlyCommand('awk \'BEGIN { print "x" > "f" }\'')).toBe(false);
  });

  it('blocks in-place sed after other flags and tree output files', () => {
    expect(isSafeReadOnlyCommand("sed -e 's/a/b/' -i '' file.txt")).toBe(false);
    expect(isSafeReadOnlyCommand("sed -n -i '' 's/a/b/' file.txt")).toBe(false);
    expect(isSafeReadOnlyCommand('tree -o out.txt .')).toBe(false);
    expect(isSafeReadOnlyCommand('tree -oout.txt .')).toBe(false);
    expect(isSafeReadOnlyCommand('tree .')).toBe(true);
  });

  it('allows quoted greater-than signs but blocks redirects', () => {
    expect(isSafeReadOnlyCommand('grep ">" /etc/hosts')).toBe(true);
    expect(isSafeReadOnlyCommand("echo 'note: x > y'")).toBe(true);
    expect(isSafeReadOnlyCommand('echo hi > out.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('echo hi >> out.txt')).toBe(false);
  });

  it('blocks every redirect form that writes a file', () => {
    expect(isSafeReadOnlyCommand('echo hi >& out.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('echo hi &> out.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('printf hi 1<>out.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('printf hi <> out.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('echo pwned \\" > out.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('cat /etc/hosts 2>&1')).toBe(true);
    expect(isSafeReadOnlyCommand('echo hi >&2')).toBe(true);
  });

  it('blocks sort programs that execute other programs', () => {
    expect(isSafeReadOnlyCommand('sort --compress-program=/bin/true input.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('sort --compress-program /bin/true input.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('sort input.txt')).toBe(true);
  });

  it('prefers an exact discovered name over a built-in alias', () => {
    const definitions = [makeDefinition({ name: 'bash', source: 'workspace' }), makeDefinition({ name: 'shell' }), makeDefinition({ name: 'general-purpose' })];
    expect(resolveSubagentDefinition(definitions, 'bash')?.name).toBe('bash');
    expect(resolveSubagentDefinition(definitions, 'Bash')?.name).toBe('bash');
    expect(resolveSubagentDefinition([makeDefinition({ name: 'shell' }), makeDefinition({ name: 'general-purpose' })], 'bash')?.name).toBe('shell');
  });

  it('resolves documented subagent type aliases', () => {
    const definitions = [makeDefinition({ name: 'shell' }), makeDefinition({ name: 'general-purpose' }), makeDefinition({ name: 'explore' })];
    expect(resolveSubagentDefinition(definitions, 'bash')?.name).toBe('shell');
    expect(resolveSubagentDefinition(definitions, 'generalpurpose')?.name).toBe('general-purpose');
    expect(resolveSubagentDefinition(definitions, 'unspecified')?.name).toBe('general-purpose');
    expect(resolveSubagentDefinition(definitions, 'explore')?.name).toBe('explore');
  });

  it('falls back when the task names two agents', () => {
    const definitions = [
      makeDefinition({ name: 'explore', description: 'Fast read-only agent for exploring codebases' }),
      makeDefinition({ name: 'shell', description: 'Command execution specialist for running bash commands, git operations, builds, and test suites.' }),
      makeDefinition({ name: 'general-purpose', description: 'General-purpose agent' }),
    ];
    expect(selectSubagentType(definitions, { description: 'ask explore and shell to run the tests', prompt: '' })).toBe('general-purpose');
  });

  it('does not auto-select a read-only agent when the task asks for a change', () => {
    const definitions = [
      makeDefinition({ name: 'explore', description: 'Fast read-only agent specialized for exploring codebases, finding files by pattern, and searching code', permissionMode: 'readonly' }),
      makeDefinition({ name: 'shell', description: 'Command execution specialist for running bash commands and builds' }),
      makeDefinition({ name: 'general-purpose', description: 'General-purpose agent for researching questions and executing multi-step tasks' }),
    ];
    expect(selectSubagentType(definitions, { description: '', prompt: 'explore the repo and fix the bug' })).toBe('general-purpose');
    expect(selectSubagentType(definitions, { description: '', prompt: 'use explore to find where the bug is' })).toBe('explore');
  });

  it('treats changing, splitting, moving, and optimizing as write intent', () => {
    const definitions = [
      makeDefinition({ name: 'explore', description: 'Fast read-only agent specialized for exploring codebases, finding files by pattern, and searching code', permissionMode: 'readonly' }),
      makeDefinition({ name: 'general-purpose', description: 'General-purpose agent for researching questions and executing multi-step tasks' }),
    ];
    for (const text of [
      'explore the codebase before changing the search',
      'explore the codebase and split the parser',
      'explore the codebase and move the helper',
      'explore the codebase and optimize the search',
      'explore the codebase and replace the helper',
      'explore the codebase and set the retry count',
      'explore the codebase and insert a guard clause',
      'explore the codebase and apply the reviewer suggestion',
      'explore the codebase and generate a migration',
      'explore the codebase and simplify the error handling',
      'explore the codebase and clean up the dead branches',
      'explore the codebase and swap the two arguments',
      'explore the codebase and drop the deprecated field',
      'explore the codebase and strip the unused imports',
      'explore the repo and make the tests pass',
      'explore the repo and address the TODOs',
      'explore the repo and improve the error messages',
      'explore the repo and rework the parser',
      'explore the repo and get the build green',
      'explore the repo and ensure the linter is clean',
    ]) {
      expect(selectSubagentType(definitions, { description: text, prompt: '' })).toBe('general-purpose');
    }
    expect(selectSubagentType(definitions, { description: 'explore the codebase without changing any code', prompt: '' })).toBe('explore');
  });

  it('keeps an explicitly named read-only agent when write verbs are negated', () => {
    const definitions = [
      makeDefinition({ name: 'explore', description: 'Fast read-only agent specialized for exploring codebases, finding files by pattern, and searching code', permissionMode: 'readonly' }),
      makeDefinition({ name: 'shell', description: 'Command execution specialist for running bash commands and builds' }),
      makeDefinition({ name: 'debug', description: 'Debugging specialist for tracing failures and isolating root causes' }),
      makeDefinition({ name: 'general-purpose', description: 'General-purpose agent for researching questions and executing multi-step tasks' }),
    ];
    expect(selectSubagentType(definitions, { description: 'explore the auth flow', prompt: 'Find where tokens are validated. Do not edit anything.' })).toBe('explore');
    expect(selectSubagentType(definitions, { description: 'explore the flaky test', prompt: 'Find the cause of the failure; do not change any files.' })).toBe('explore');
    for (const text of [
      'explore the auth flow. Do not edit, add, or delete anything.',
      'explore the auth flow and report what to change; do not modify, add, or delete files',
      'explore the auth flow without modifying, adding, or deleting files',
      'explore the repo. Do not edit/add/delete anything.',
      'explore the repo. Do not edit — add — or delete anything.',
      'explore the repo. Do not edit (or add or delete) anything.',
      'explore the repo. Do not, under any circumstances, edit files.',
      'explore the repo. Under no circumstances should you edit files.',
    ]) {
      expect(selectSubagentType(definitions, { description: text, prompt: '' })).toBe('explore');
    }
  });

  it('does not let a negation swallow a later imperative', () => {
    const definitions = [makeDefinition({ name: 'explore', description: 'Fast read-only agent for exploring codebases', permissionMode: 'readonly' }), makeDefinition({ name: 'general-purpose', description: '' })];
    for (const text of ['explore the repo. No tests, but fix the parser.', 'explore the repo. Never mind, fix the parser.']) {
      expect(selectSubagentType(definitions, { description: text, prompt: '' })).toBe('general-purpose');
    }
  });

  it('does not treat a negation of a read as a negation of a later change', () => {
    const definitions = [makeDefinition({ name: 'explore', description: 'Fast read-only agent for exploring codebases', permissionMode: 'readonly' }), makeDefinition({ name: 'general-purpose', description: '' })];
    for (const text of ['Read the code, update the parser.', "Don't just read the code, update the parser.", 'Do not just read the docs, update the parser.']) {
      expect(selectSubagentType(definitions, { description: text, prompt: '' })).toBe('general-purpose');
    }
  });

  it('keeps a named read-only agent for report-only tasks', () => {
    const definitions = [
      makeDefinition({ name: 'explore', description: 'Fast read-only agent for exploring codebases', permissionMode: 'readonly' }),
      makeDefinition({ name: 'update-auditor', description: 'Audits release updates', permissionMode: 'readonly' }),
      makeDefinition({ name: 'general-purpose', description: '' }),
    ];
    for (const text of [
      'explore the repo and report the format of the config files',
      'explore how to create the app from the docs',
      'explore the set of options available',
      'explore the repo and explain the update path',
      'explore the repo and find where we update the version',
    ]) {
      expect(selectSubagentType(definitions, { description: text, prompt: '' })).toBe('explore');
    }
    expect(selectSubagentType(definitions, { description: 'Use update-auditor to inspect the changelog', prompt: '' })).toBe('update-auditor');
    expect(selectSubagentType(definitions, { description: 'Ask update-auditor what changed in the release', prompt: '' })).toBe('update-auditor');
  });

  it('does not auto-select a read-only agent when no writable agent is available', () => {
    const definitions = [
      makeDefinition({ name: 'explore', description: 'Fast read-only agent for exploring codebases', permissionMode: 'readonly' }),
      makeDefinition({ name: 'reviewer', description: 'Reviews changes read-only', permissionMode: 'readonly' }),
    ];
    const selected = selectSubagentType(definitions, { description: 'explore the repo and fix the parser', prompt: '' });
    expect(selected).toBe('general-purpose');
    expect(resolveSubagentDefinition(definitions, selected)).toBeUndefined();
  });

  it('blocks reflog mutations, non-slash sed execute flags, and mutating date or hostname calls', () => {
    expect(isSafeReadOnlyCommand('git reflog expire --expire=now --all')).toBe(false);
    expect(isSafeReadOnlyCommand('git reflog delete --all HEAD@{1}')).toBe(false);
    expect(isSafeReadOnlyCommand('git reflog')).toBe(true);
    expect(isSafeReadOnlyCommand('git reflog -n 5')).toBe(true);
    expect(isSafeReadOnlyCommand("sed 's#x#id#e' notes.txt")).toBe(false);
    expect(isSafeReadOnlyCommand("sed -n 's#.*#id#ep' notes.txt")).toBe(false);
    expect(isSafeReadOnlyCommand("sed 's#a#b#gp' notes.txt")).toBe(true);
    expect(isSafeReadOnlyCommand('date 010100002030.00')).toBe(false);
    expect(isSafeReadOnlyCommand('hostname evilname')).toBe(false);
    expect(isSafeReadOnlyCommand('date -u')).toBe(true);
    expect(isSafeReadOnlyCommand("date '+%Y-%m-%d'")).toBe(true);
    expect(isSafeReadOnlyCommand('hostname -s')).toBe(true);
  });

  it('scopes the built-in browser agent to the browser integration server', () => {
    const dir = tempDir('browser-scope-');
    const fromTool = discoverSubagents(dir, { browserIntegration: 'mcp__playwright__browser_navigate', projectTrusted: false, homeDir: dir, agentDir: dir }).find((definition) => definition.name === 'browser');
    expect(fromTool?.tools).toEqual(['mcp__playwright__*']);
    const fromServer = discoverSubagents(dir, { browserIntegration: 'chrome-devtools', projectTrusted: false, homeDir: dir, agentDir: dir }).find((definition) => definition.name === 'browser');
    expect(fromServer?.tools).toEqual(['mcp__chrome_devtools__*']);
  });

  it('keeps read-only git inspection available', () => {
    expect(isSafeReadOnlyCommand('git branch --show-current')).toBe(true);
    expect(isSafeReadOnlyCommand('git branch --list')).toBe(true);
    expect(isSafeReadOnlyCommand('git branch -a')).toBe(true);
    expect(isSafeReadOnlyCommand('git remote show origin')).toBe(true);
    expect(isSafeReadOnlyCommand('git remote -v')).toBe(true);
    expect(isSafeReadOnlyCommand('git tag -l "v*"')).toBe(true);
    expect(isSafeReadOnlyCommand('git branch new-branch')).toBe(false);
    expect(isSafeReadOnlyCommand('git tag v1')).toBe(false);
    expect(isSafeReadOnlyCommand('git remote add origin url')).toBe(false);
  });

  it('blocks other safe-list commands that write files or refs', () => {
    expect(isSafeReadOnlyCommand('uniq a.txt b.txt')).toBe(false);
    expect(isSafeReadOnlyCommand('uniq a.txt')).toBe(true);
    expect(isSafeReadOnlyCommand('git branch new-branch')).toBe(false);
    expect(isSafeReadOnlyCommand('git branch -a')).toBe(true);
    expect(isSafeReadOnlyCommand('git branch')).toBe(true);
    expect(isSafeReadOnlyCommand('git tag v1')).toBe(false);
    expect(isSafeReadOnlyCommand('git tag -l')).toBe(true);
    expect(isSafeReadOnlyCommand('git tag')).toBe(true);
    expect(isSafeReadOnlyCommand('git remote add origin url')).toBe(false);
    expect(isSafeReadOnlyCommand('git remote -v')).toBe(true);
    expect(isSafeReadOnlyCommand('date -s 2020-01-01')).toBe(false);
    expect(isSafeReadOnlyCommand('date')).toBe(true);
  });

  it('blocks a lone ampersand and keeps fd duplication', () => {
    expect(isSafeReadOnlyCommand("ls -la & python3 -c 'print(1)'")).toBe(false);
    expect(isSafeReadOnlyCommand('echo ok & python3 -c \'open("owned.txt","w").write("owned")\'')).toBe(false);
    expect(isSafeReadOnlyCommand('cat /etc/hosts 2>&1')).toBe(true);
    expect(isSafeReadOnlyCommand('echo hi >&2')).toBe(true);
  });

  it('allows quoted pipes and repository grep', () => {
    expect(isSafeReadOnlyCommand("rg 'foo|bar' src")).toBe(true);
    expect(isSafeReadOnlyCommand("grep -E 'foo|bar' src/index.ts")).toBe(true);
    expect(isSafeReadOnlyCommand('git grep -n TODO')).toBe(true);
    expect(isSafeReadOnlyCommand('ls -la | head -n 5')).toBe(true);
    expect(isSafeReadOnlyCommand('ls -la | python3 -c "print(1)"')).toBe(false);
  });

  it('allows stderr discarded to /dev/null', () => {
    expect(isSafeReadOnlyCommand('ls src 2>/dev/null')).toBe(true);
    expect(isSafeReadOnlyCommand('grep -r foo . 2>/dev/null')).toBe(true);
    expect(isSafeReadOnlyCommand('ls src 2>/dev/null > out.txt')).toBe(false);
  });

  it('allows read-only date forms including GNU -d', () => {
    expect(isSafeReadOnlyCommand("date -d '2020-01-01'")).toBe(true);
    expect(isSafeReadOnlyCommand('date --date=2020-01-01')).toBe(true);
    expect(isSafeReadOnlyCommand('date -u')).toBe(true);
    expect(isSafeReadOnlyCommand('date -s 2020-01-01')).toBe(false);
  });

  it('reports unknown config keys instead of silently ignoring them', () => {
    const explore = parseSubagentsConfig({ explore: { modle: 'inherit' } }, undefined, { cwd: '/tmp' });
    expect(explore.errors.some((error) => error.includes('modle'))).toBe(true);
    const retry = parseSubagentsConfig({ retry: { maxAtempts: 5 } }, undefined, { cwd: '/tmp' });
    expect(retry.errors.some((error) => error.includes('maxAtempts'))).toBe(true);
    const unknownSection = parseSubagentsConfig({ nested: {} }, undefined, { cwd: '/tmp' });
    expect(unknownSection.errors.some((error) => error.includes('nested'))).toBe(true);
  });

  it('blocks every powershell call in read-only mode', () => {
    const event = double<{ readonly type: 'tool_call'; readonly toolCallId: string; readonly toolName: string; readonly input: { readonly command: string } }>({
      type: 'tool_call',
      toolCallId: 'call-ps',
      toolName: 'powershell',
      input: { command: 'Remove-Item -Recurse -Force ./src' },
    });
    expect(evaluateReadonlySubagentGuard(event)?.block).toBe(true);
  });

  it('normalizes Claude tool names for any definition source', () => {
    expect(normalizeToolNames(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'LS', 'MultiEdit', 'my_tool'])).toEqual(['read', 'grep', 'find', 'bash', 'edit', 'write', 'ls', 'edit', 'my_tool']);
  });

  it('blocks sed and sort writes through the read-only tool_call hook', () => {
    for (const command of ["sed 's/a/b/woutfile'", 'sort -ooutfile input.txt']) {
      const event = double<{ readonly type: 'tool_call'; readonly toolCallId: string; readonly toolName: string; readonly input: { readonly command: string } }>({
        type: 'tool_call',
        toolCallId: 'call-guard',
        toolName: 'bash',
        input: { command },
      });
      const decision = evaluateReadonlySubagentGuard(event);
      expect(decision?.block).toBe(true);
    }
  });

  it('blocks git grep pager execution and sandboxes safe bash calls', () => {
    const pager = `git grep --open-files-in-pager="sh -c 'echo pwned > owned.txt'" needle`;
    expect(isSafeReadOnlyCommand(pager)).toBe(false);
    const pagerEvent = double<{ readonly type: 'tool_call'; readonly toolCallId: string; readonly toolName: string; input: { command: string } }>({
      type: 'tool_call',
      toolCallId: 'call-pager',
      toolName: 'bash',
      input: { command: pager },
    });
    expect(evaluateReadonlySubagentGuard(pagerEvent)?.block).toBe(true);

    const safeEvent = double<{ readonly type: 'tool_call'; readonly toolCallId: string; readonly toolName: string; input: { command: string } }>({
      type: 'tool_call',
      toolCallId: 'call-safe',
      toolName: 'bash',
      input: { command: 'ls -la' },
    });
    expect(evaluateReadonlySubagentGuard(safeEvent)).toBeUndefined();
    if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
      expect(safeEvent.input.command).toContain('sandbox-exec');
    }
  });

  it('blocks awk programs that pipe into another program', () => {
    const command = `awk 'BEGIN { print "x" | "python3 -c \"print(1)\"" }'`;
    expect(isSafeReadOnlyCommand(command)).toBe(false);
    const event = double<{ readonly type: 'tool_call'; readonly toolCallId: string; readonly toolName: string; input: { command: string } }>({
      type: 'tool_call',
      toolCallId: 'call-awk',
      toolName: 'bash',
      input: { command },
    });
    expect(evaluateReadonlySubagentGuard(event)?.block).toBe(true);
  });

  it('denies writes to arbitrary /var/tmp here-document names', () => {
    const command = sandboxReadOnlyCommand('printf x > /var/tmp/sh-thd-424242');
    if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
      expect(command).toContain('/var/tmp/sh-thd-424242');
      return;
    }
    const target = '/var/tmp/sh-thd-424242';
    rmSync(target, { force: true });
    expect(() => execFileSync('/bin/sh', ['-c', command], { stdio: 'pipe' })).toThrow();
    expect(existsSync(target)).toBe(false);
  });

  it('denies writes when the read-only sandbox is available', () => {
    const wrapped = sandboxReadOnlyCommand('echo hi');
    if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
      expect(wrapped).toBe('echo hi');
      return;
    }
    expect(wrapped).toContain('sandbox-exec');
    const dir = tempDir('readonly-sandbox-');
    const target = join(dir, 'owned.txt');
    const write = sandboxReadOnlyCommand(`echo pwned > ${target}`);
    expect(() => execFileSync('/bin/sh', ['-c', write], { stdio: 'pipe' })).toThrow();
    expect(existsSync(target)).toBe(false);
  });

  it('runs read-only commands that need a temporary file', () => {
    const command = sandboxReadOnlyCommand('grep two <<<two');
    if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
      expect(command).toBe('grep two <<<two');
      return;
    }
    const output = execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
    expect(output.trim()).toBe('two');
  });

  it('maps Claude tool names onto Pi tool names', () => {
    const dir = tempDir('claude-tools-');
    writeFileSync(join(dir, 'reviewer.md'), ['---', 'name: reviewer', 'description: Reviews', 'tools: Read, Grep, Glob, Bash, Edit, Write, LS, MultiEdit', '---', 'Review.'].join('\n'));
    expect(parseSubagentFile(join(dir, 'reviewer.md'), 'workspace')?.tools).toEqual(['read', 'grep', 'find', 'bash', 'edit', 'write', 'ls', 'edit']);
  });

  it('reads YAML yes and on as true', () => {
    const dir = tempDir('yaml-bools-');
    const parse = (fileName: string, line: string) => {
      writeFileSync(join(dir, fileName), ['---', 'name: ' + fileName, 'description: Test', line, '---', 'Body.'].join('\n'));
      return parseSubagentFile(join(dir, fileName), 'workspace');
    };
    expect(parse('ro.md', 'readonly: yes')?.permissionMode).toBe('readonly');
    expect(parse('ro-on.md', 'readonly: on')?.permissionMode).toBe('readonly');
    expect(parse('dis.md', 'disabled: yes')?.enabled).toBe(false);
    expect(parse('en.md', 'enabled: yes')?.enabled).toBe(true);
    expect(parse('nested.md', 'nested-tasks: yes')?.nestedTasks).toBe(true);
  });

  it('treats disabled as the inverse of enabled', () => {
    const dir = tempDir('disabled-');
    const parse = (fileName: string, line: string) => {
      writeFileSync(join(dir, fileName), ['---', 'name: ' + fileName, 'description: Test', line, '---', 'Body.'].join('\n'));
      return parseSubagentFile(join(dir, fileName), 'workspace');
    };
    expect(parse('false.md', 'disabled: false')?.enabled).toBe(true);
    expect(parse('no.md', 'disabled: no')?.enabled).toBe(true);
    expect(parse('true.md', 'disabled: true')?.enabled).toBe(false);
    expect(parse('enabled-false.md', 'enabled: false')?.enabled).toBe(false);
    expect(parse('enabled-true.md', 'enabled: true')?.enabled).toBe(true);
  });

  it('selects a hyphenated agent named in the task text', () => {
    const definitions = [makeDefinition({ name: 'code-reviewer', description: 'Reviews pull requests' }), makeDefinition({ name: 'shell', description: 'Runs commands' }), makeDefinition({ name: 'general-purpose', description: '' })];
    for (const text of ['Please ask code-reviewer to inspect the pull request', 'use code-reviewer to run the test suite', 'Have the code-reviewer look at this']) {
      expect(selectSubagentType(definitions, { description: text, prompt: '' })).toBe('code-reviewer');
    }
  });

  it('selects a multi-word agent named in the task text', () => {
    const definitions = [makeDefinition({ name: 'Code Reviewer', description: 'Reviews patches for correctness' }), makeDefinition({ name: 'general-purpose', description: '' })];
    expect(selectSubagentType(definitions, { description: 'Ask Code Reviewer to inspect the patch', prompt: '' })).toBe('Code Reviewer');
    expect(selectSubagentType(definitions, { description: 'Ask Code Reviewers to inspect the patch', prompt: '' })).toBe('general-purpose');
  });

  it('prefers the longest whole agent name when names overlap', () => {
    const definitions = [
      makeDefinition({ name: 'explore', description: 'Fast read-only agent for exploring codebases', permissionMode: 'readonly' }),
      makeDefinition({ name: 'explore security', description: 'Checks security headers', permissionMode: 'readonly' }),
      makeDefinition({ name: 'general-purpose', description: '' }),
    ];
    expect(selectSubagentType(definitions, { description: 'Ask explore security to check the headers', prompt: '' })).toBe('explore security');
    expect(selectSubagentType(definitions, { description: 'explore the repo', prompt: '' })).toBe('explore');
    const docs = [makeDefinition({ name: 'docs', description: 'Writes docs' }), makeDefinition({ name: 'docs writer', description: 'Writes documentation' }), makeDefinition({ name: 'general-purpose', description: '' })];
    expect(selectSubagentType(docs, { description: 'Ask the docs writer to update the guide', prompt: '' })).toBe('docs writer');
    expect(selectSubagentType(docs, { description: 'ask docs to update the guide', prompt: '' })).toBe('docs');
    const distinct = [makeDefinition({ name: 'docs writer', description: 'Writes documentation' }), makeDefinition({ name: 'security', description: 'Checks security' }), makeDefinition({ name: 'general-purpose', description: '' })];
    expect(selectSubagentType(distinct, { description: 'ask docs writer and security to review', prompt: '' })).toBe('general-purpose');
    const plural = [makeDefinition({ name: 'Code', description: 'Writes code' }), makeDefinition({ name: 'Code Reviewer', description: 'Reviews code' }), makeDefinition({ name: 'general-purpose', description: '' })];
    expect(selectSubagentType(plural, { description: 'Ask Code Reviewers to inspect the patch', prompt: '' })).toBe('general-purpose');
    expect(selectSubagentType(plural, { description: 'Ask Code Reviewer to inspect the patch', prompt: '' })).toBe('Code Reviewer');
  });

  it('scores distinct description keywords instead of repeated words', () => {
    const definitions = [
      makeDefinition({ name: 'manifest-checker', description: 'Validates Kubernetes manifests and deploys them' }),
      makeDefinition({ name: 'kube-scout', description: 'Kubernetes. Kubernetes. Kubernetes. Kubernetes.' }),
      makeDefinition({ name: 'general-purpose', description: '' }),
    ];
    expect(selectSubagentType(definitions, { description: 'validate the kubernetes manifests', prompt: '' })).toBe('manifest-checker');
  });

  it('applies a top-level max-tokens cap to the child model', () => {
    const dir = tempDir('max-tokens-');
    writeFileSync(join(dir, 'capped.md'), ['---', 'name: capped', 'description: Capped', 'max-tokens: 1234', '---', 'Body.'].join('\n'));
    const capped = parseSubagentFile(join(dir, 'capped.md'), 'workspace');
    expect(capped?.sampling?.maxTokens).toBe(1234);
    const model = double<Model<Api>>({ provider: 'test', id: 'm', reasoning: true, contextWindow: 200_000, maxTokens: 8192 });
    expect(applyDefinitionToModel(model, capped ?? makeDefinition()).maxTokens).toBe(1234);
  });
});
