import { describe, expect, it } from 'vitest';
import { agyToolFor, type BridgeInput, BRIDGED_TOOLS, bridgeToolCall } from '../src/tools.ts';
import type { ToolBridgeCall } from '../src/types.ts';

const ALL = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] as const;
const START_LINE = 10;
const END_LINE = 12;
const LINE_COUNT = 3;

interface Case {
  readonly title: string;
  readonly input: BridgeInput;
  readonly declared: readonly string[];
  readonly expected: ToolBridgeCall | undefined;
}

function call(name: string, rawInput: unknown, callId: string | undefined = 'call-1'): BridgeInput {
  return { name, rawInput, callId };
}

function bridged(piTool: string, args: Record<string, unknown>, agyTool: string, callId = 'call-1'): ToolBridgeCall {
  return { piTool, arguments: args, agyTool, callId };
}

const cases: readonly Case[] = [
  {
    title: 'view_file reads a path and an inclusive line span',
    input: call('view_file', { AbsolutePath: '/tmp/a.ts', StartLine: START_LINE, EndLine: END_LINE }),
    declared: ALL,
    expected: bridged('read', { path: '/tmp/a.ts', offset: START_LINE, limit: LINE_COUNT }, 'view_file'),
  },
  {
    title: 'view_file without an end line sets only the offset',
    input: call('view_file', { AbsolutePath: '/tmp/a.ts', StartLine: START_LINE }),
    declared: ALL,
    expected: bridged('read', { path: '/tmp/a.ts', offset: START_LINE }, 'view_file'),
  },
  {
    title: 'view_file drops an inverted line span',
    input: call('view_file', { AbsolutePath: '/tmp/a.ts', StartLine: END_LINE, EndLine: START_LINE }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'view_file requires AbsolutePath',
    input: call('view_file', { StartLine: START_LINE }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'write_to_file writes TargetFile and CodeContent',
    input: call('write_to_file', { TargetFile: '/tmp/a.ts', CodeContent: 'hello', Overwrite: true }),
    declared: ALL,
    expected: bridged('write', { path: '/tmp/a.ts', content: 'hello' }, 'write_to_file'),
  },
  {
    title: 'write_to_file refuses an append because Pi write would replace the file',
    input: call('write_to_file', { TargetFile: '/tmp/a.ts', CodeContent: 'hello', Append: true }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'write_to_file requires CodeContent',
    input: call('write_to_file', { TargetFile: '/tmp/a.ts' }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'replace_file_content becomes one edit',
    input: call('replace_file_content', {
      TargetFile: '/tmp/a.ts',
      TargetContent: 'old',
      ReplacementContent: 'new',
    }),
    declared: ALL,
    expected: bridged('edit', { path: '/tmp/a.ts', edits: [{ oldText: 'old', newText: 'new' }] }, 'replace_file_content'),
  },
  {
    title: 'replace_file_content requires TargetContent',
    input: call('replace_file_content', { TargetFile: '/tmp/a.ts', ReplacementContent: 'new' }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'run_command maps CommandLine and the summary metadata',
    input: call('run_command', { CommandLine: 'ls -la', toolSummary: 'List directory contents' }),
    declared: ALL,
    expected: bridged('bash', { command: 'ls -la' }, 'run_command'),
  },
  {
    title: 'run_command requires CommandLine',
    input: call('run_command', { Cwd: '/tmp' }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'grep_search maps the query, path, case, and a single include',
    input: call('grep_search', {
      Query: 'Token',
      SearchPath: '/tmp/src',
      CaseInsensitive: true,
      IsRegex: false,
      Includes: ['*.ts'],
    }),
    declared: ALL,
    expected: bridged('grep', { pattern: 'Token', path: '/tmp/src', ignoreCase: true, literal: true, glob: '*.ts' }, 'grep_search'),
  },
  {
    title: 'grep_search requires Query',
    input: call('grep_search', { SearchPath: '/tmp/src' }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'find_by_name maps Pattern and SearchDirectory',
    input: call('find_by_name', { Pattern: '*.ts', SearchDirectory: '/tmp/src', Extensions: ['ts'] }),
    declared: ALL,
    expected: bridged('find', { pattern: '*.ts', path: '/tmp/src' }, 'find_by_name'),
  },
  {
    title: 'find_by_name requires Pattern',
    input: call('find_by_name', { SearchDirectory: '/tmp/src' }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'list_dir maps DirectoryPath',
    input: call('list_dir', { DirectoryPath: '/tmp/src' }),
    declared: ALL,
    expected: bridged('ls', { path: '/tmp/src' }, 'list_dir'),
  },
  {
    title: 'list_dir requires DirectoryPath',
    input: call('list_dir', {}),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'an undeclared Pi tool is not called',
    input: call('view_file', { AbsolutePath: '/tmp/a.ts' }),
    declared: ['bash'],
    expected: undefined,
  },
  {
    title: 'an unknown CLI tool is not called',
    input: call('web_search', { Query: 'docs' }),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'a non-object rawInput is not called',
    input: call('run_command', 'ls -la'),
    declared: ALL,
    expected: undefined,
  },
  {
    title: 'a missing call id becomes unknown',
    input: { name: 'run_command', rawInput: { CommandLine: 'pwd' }, callId: undefined },
    declared: ALL,
    expected: bridged('bash', { command: 'pwd' }, 'run_command', 'unknown'),
  },
];

describe('bridgeToolCall', () => {
  it.each(cases)('$title', ({ input, declared, expected }) => {
    expect(bridgeToolCall(input, new Set(declared))).toEqual(expected);
  });
});

describe('the bridge catalog', () => {
  it('names one CLI tool for each Pi tool, in bridge order', () => {
    expect(BRIDGED_TOOLS).toEqual(['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']);
    expect(agyToolFor('edit')).toBe('replace_file_content');
    expect(agyToolFor('read')).toBe('view_file');
    expect(agyToolFor('not-a-tool')).toBeUndefined();
  });
});
