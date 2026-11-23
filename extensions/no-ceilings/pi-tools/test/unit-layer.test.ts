import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation';
import { describe, expect, it } from 'vitest';
import { analyzeCommand, splitCommand } from '../src/core/command.ts';
import { LayerError, layerError, toFailure } from '../src/core/errors.ts';
import { createPolicy, decide, decideMany, ruleMatches } from '../src/core/policy.ts';
import { guarded } from '../src/core/tool.ts';
import { createHarness } from './harness.ts';

/**
 * Unit coverage for the four layer contracts: argument validation, authorization, result
 * normalization, and error handling. Validation runs through Pi's real validator, not a copy.
 */

const validToolCases = [
  ['read', { path: 'a.txt' }],
  ['ls', {}],
  ['find', { pattern: '*.ts' }],
  ['grep', { pattern: 'needle' }],
  ['write', { path: 'a.txt', content: 'x' }],
  ['edit', { path: 'a.txt', edits: [{ oldText: 'a', newText: 'b' }] }],
  ['bash', { command: 'true' }],
  ['delete', { path: 'a.txt' }],
  ['apply_patch', { patch: '*** Begin Patch\n*** End Patch' }],
  ['git', { subcommand: 'status' }],
  ['web_fetch', { url: 'https://example.com' }],
  ['web_search', { query: 'x' }],
  ['save_resource', { path: 'a.txt', content: 'x' }],
  ['search_tools', { query: 'patch' }],
] as const;

describe('unit: tool argument validation', () => {
  it.for(validToolCases)('accepts valid arguments for %s', async ([name, args]) => {
    const harness = await createHarness();
    try {
      const tool = harness.tool(name);
      expect(() => validateToolArguments(tool as never, { id: 'call', name, arguments: args } as never)).not.toThrow();
    } finally {
      await harness.cleanup();
    }
  });

  it('covers every registered tool in the valid-argument matrix', async () => {
    const harness = await createHarness();
    try {
      const registered = harness
        .tools()
        .map((tool) => tool.name)
        .sort();
      const tested = validToolCases.map(([name]) => name).sort();
      expect(tested).toEqual(registered);
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects a missing required field and a wrong-typed field', async () => {
    const harness = await createHarness();
    try {
      const read = harness.tool('read');
      expect(() => validateToolArguments(read as never, { id: 'call', name: 'read', arguments: {} } as never)).toThrow(/Validation failed for tool "read"[\s\S]*path: missing/);
      expect(() => validateToolArguments(harness.tool('grep') as never, { id: 'call', name: 'grep', arguments: { pattern: { nested: true } } } as never)).toThrow(/pattern/);
    } finally {
      await harness.cleanup();
    }
  });

  it('coerces loosely typed arguments the way Pi does', async () => {
    const harness = await createHarness();
    try {
      const read = validateToolArguments(harness.tool('read') as never, { id: 'call', name: 'read', arguments: { path: 'a.txt', offset: '2', limit: '3' } } as never) as { offset: number; limit: number };
      expect(read.offset).toBe(2);
      expect(read.limit).toBe(3);
      const edit = validateToolArguments(
        harness.tool('edit') as never,
        {
          id: 'call',
          name: 'edit',
          arguments: { path: 'a.txt', edits: { oldText: 'a', newText: 'b' } },
        } as never,
      ) as { edits: { oldText: string }[] };
      expect(edit.edits).toBeInstanceOf(Array);
      expect(edit.edits[0]?.oldText).toBe('a');
    } finally {
      await harness.cleanup();
    }
  });

  it.for(['read', 'ls', 'find', 'grep', 'write', 'delete'] as const)('declares prepareArguments on %s', async (name) => {
    const harness = await createHarness();
    try {
      const tool = harness.tool(name);
      expect(typeof tool.prepareArguments).toBe('function');
    } finally {
      await harness.cleanup();
    }
  });

  it('repairs aliases before validation on path-taking tools', async () => {
    const harness = await createHarness();
    try {
      const repaired = harness.tool('read').prepareArguments?.({ file_path: '@a.txt', offset: '1' });
      const validated = validateToolArguments(harness.tool('read') as never, { id: 'call', name: 'read', arguments: repaired } as never) as { path: string; offset: number };
      expect(validated).toEqual({ path: '@a.txt', offset: 1 });
      expect(() => validateToolArguments(harness.tool('read') as never, { id: 'call', name: 'read', arguments: harness.tool('read').prepareArguments?.({}) } as never)).toThrow(/path: missing/);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('unit: authorization', () => {
  const policy = createPolicy({
    cwd: '/repo/app',
    home: '/home/tester',
    mode: 'auto',
    rules: [
      { kind: 'read', action: 'deny', pattern: '**/secret.txt' },
      { kind: 'exec', action: 'deny', pattern: 'echo secret*' },
    ],
  });

  it('allows inside the workspace, denies outside without a prompt, approves with one', () => {
    expect(decide(policy, 'read', '/repo/app/src/a.ts', { canPrompt: false }).kind).toBe('allow');
    expect(decide(policy, 'write', '/elsewhere/a.ts', { canPrompt: false }).kind).toBe('deny');
    expect(decide(policy, 'write', '/elsewhere/a.ts', { canPrompt: true }).kind).toBe('approve');
  });

  it('checks deny rules on the named path and the canonical path', () => {
    expect(decideMany(policy, 'read', ['/repo/app/link.txt', '/repo/app/secret.txt'], { canPrompt: true }).kind).toBe('deny');
  });

  it('requires the canonical target to be allowed in allowlist mode', () => {
    const strict = createPolicy({ cwd: '/repo/app', home: '/home/tester', mode: 'allowlist', rules: [{ kind: 'read', action: 'allow', pattern: '**/public.txt' }] });
    expect(decideMany(strict, 'read', ['/repo/app/public.txt', '/repo/app/secret.txt'], { canPrompt: true }).kind).toBe('deny');
    expect(decideMany(strict, 'read', ['/repo/app/public.txt'], { canPrompt: true }).kind).toBe('allow');
  });

  it('matches command spellings, not just the literal string', () => {
    const rule = { kind: 'exec' as const, action: 'deny' as const, pattern: 'echo secret*' };
    expect(ruleMatches(rule, 'echo secret-value', policy)).toBe(true);
    expect(ruleMatches(rule, 'echo  secret-value', policy)).toBe(true);
    expect(ruleMatches(rule, 'echo secret/value', policy)).toBe(true);
    expect(ruleMatches(rule, 'echo public-value', policy)).toBe(false);
    expect(analyzeCommand('sh -c "echo secret-value"')).toContain('echo secret-value');
    expect(analyzeCommand('FOO=1 env echo secret-value')).toContain('echo secret-value');
    expect(splitCommand('echo "a; b"; echo c')).toEqual(['echo "a; b"', 'echo c']);
  });
});

describe('unit: result normalization', () => {
  it('returns model content, details, and structured content on success', async () => {
    const execute = guarded<{ value: string }, { echoed: string }>(
      (failure) => ({ echoed: failure.message }),
      async ({ params }) => ({
        content: [{ type: 'text', text: `value=${params.value}` }],
        details: { echoed: params.value },
        structuredContent: { value: params.value },
      }),
    );
    const result = await execute('call', { value: 'x' }, undefined, undefined, { cwd: process.cwd() });
    expect(result.content).toEqual([{ type: 'text', text: 'value=x' }]);
    expect(result.details).toEqual({ echoed: 'x' });
    expect(result.structuredContent).toEqual({ value: 'x' });
    expect(result.isError).toBeUndefined();
  });

  it('turns a thrown layer error into an error result with typed details', async () => {
    const execute = guarded<Record<string, never>, { failure?: { kind: string } }>(
      (failure) => ({ failure }),
      async () => {
        throw layerError('permission_denied', 'Blocked by test');
      },
    );
    const result = await execute('call', {}, undefined, undefined, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Blocked by test' }]);
    expect(result.details.failure?.kind).toBe('permission_denied');
  });

  it('normalizes an unexpected throw and reports operation failures as results', async () => {
    const harness = await createHarness();
    try {
      const missing = await harness.call('read', { path: 'nope.txt' });
      expect(missing.isError).toBe(true);
      expect(missing.content[0]).toEqual({ type: 'text', text: expect.stringContaining('File not found') });
      expect((missing.details as { failure?: { kind?: string } }).failure?.kind).toBe('file_not_found');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('unit: error handling', () => {
  it('maps errno codes to failure kinds and preserves layer errors', () => {
    expect(toFailure(Object.assign(new Error('x'), { code: 'ENOENT' }), '/a').kind).toBe('file_not_found');
    expect(toFailure(Object.assign(new Error('x'), { code: 'EACCES' }), '/a').kind).toBe('permission_denied');
    expect(toFailure(Object.assign(new Error('x'), { code: 'ENOSPC' }), '/a').kind).toBe('no_space');
    expect(toFailure('plain', '/a').message).toBe('plain');
    const layer = layerError('invalid_file', 'not text');
    expect(toFailure(layer)).toBe((layer as LayerError).failure);
  });

  it('aborts before running when the signal is already aborted', async () => {
    const execute = guarded<Record<string, never>, { failure?: { kind: string } }>(
      (failure) => ({ failure }),
      async () => {
        throw new Error('should not run');
      },
    );
    const controller = new AbortController();
    controller.abort();
    const result = await execute('call', {}, controller.signal, undefined, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
    expect(result.details.failure?.kind).toBe('rejected');
  });
});
