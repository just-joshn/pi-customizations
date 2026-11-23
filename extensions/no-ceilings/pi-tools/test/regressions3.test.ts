import { readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { analyzeCommand, directoryChanges } from '../src/core/command.ts';
import { createPolicy, decide, ruleMatches } from '../src/core/policy.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the third adversarial pass. Each test names the finding it locks down. */

describe('finding 1: exec rules cover quoting, wrappers, and nested shells', () => {
  const harness = () => createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] } });

  it('blocks quoted, escaped, and prefixed forms', async () => {
    const h = await harness();
    try {
      const variants = [
        "echo 'secret-value'",
        'echo "secret-value"',
        'echo sec"ret"-value',
        "echo sec''ret-value",
        "echo $'secret-value'",
        'sh -c "echo secret-value" > out.txt',
        '/bin/sh -c "echo secret-value"',
        'bash -lc "echo secret-value"',
        'command -p echo secret-value',
        'env -i PATH="$PATH" echo secret-value',
        "eval 'echo secret-value' > out.txt",
      ];
      for (const command of variants) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('Blocked by permissions configuration');
      }
    } finally {
      await h.cleanup();
    }
  });

  it('returns the same analyzed strings for equivalent spellings', () => {
    const policy = createPolicy({ cwd: '/x', rules: [{ kind: 'exec', action: 'deny', pattern: 'echo secret*' }] });
    for (const variant of [
      "echo 'secret-value'",
      'echo "secret-value"',
      'echo sec"ret"-value',
      "echo sec''ret-value",
      "echo $'secret-value'",
      'sh -c "echo secret-value" > out.txt',
      '/bin/sh -c "echo secret-value"',
      'bash -lc "echo secret-value"',
      'command -p echo secret-value',
      'env -i PATH="$PATH" echo secret-value',
      "eval 'echo secret-value' > out.txt",
    ]) {
      const analyzed = analyzeCommand(variant);
      expect(analyzed).toContain('echo secret-value');
      expect(analyzed.some((segment) => ruleMatches({ kind: 'exec', action: 'deny', pattern: 'echo secret*' }, segment, policy))).toBe(true);
    }
  });
});

describe('finding 2: cd targets inside subshells and nested shells are gated', () => {
  it('blocks cd --, sh -c, /bin/sh -c, and ( ... )', async () => {
    const h = await createHarness();
    try {
      for (const command of ['cd -- /etc && pwd', "sh -c 'cd /etc && pwd'", "/bin/sh -c 'cd /etc && pwd'", '(cd /etc && pwd)']) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain('outside the workspace');
      }
    } finally {
      await h.cleanup();
    }
  });

  it('reports nested directory changes', () => {
    expect(directoryChanges("sh -c 'cd /tmp && pwd'")).toEqual(['/tmp']);
    expect(directoryChanges('cd -- /tmp && pwd')).toEqual(['/tmp']);
    expect(directoryChanges('(cd /tmp && pwd)')).toEqual(['/tmp']);
  });
});

describe('finding 3: shell startup env is stripped', () => {
  it('does not run BASH_ENV', async () => {
    const h = await createHarness();
    try {
      await h.write('startup.sh', 'echo secret-value\n');
      const result = await h.call('bash', { command: 'true', env: { BASH_ENV: h.file('startup.sh') } });
      expect(textOf(result)).not.toContain('secret-value');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 4: allowlist search applies read allow rules to results', () => {
  it('does not leak a denied file when only the root matches', async () => {
    const h = await createHarness({ config: { mode: 'allowlist', rules: [{ kind: 'read', action: 'allow', pattern: 'workspace' }] } });
    try {
      await h.write('secret.txt', 'SECRET-NEEDLE\n');
      await h.write('public.txt', 'public needle\n');
      const grep = await h.call('grep', { pattern: 'NEEDLE' });
      expect(textOf(grep)).toBe('No matches found');
      const ls = await h.call('ls', {});
      expect(textOf(ls)).not.toContain('secret.txt');
    } finally {
      await h.cleanup();
    }
  });

  it('finds matches under a file-pattern allow rule', async () => {
    const h = await createHarness({
      config: {
        mode: 'allowlist',
        rules: [
          { kind: 'read', action: 'allow', pattern: '**/*.txt' },
          { kind: 'read', action: 'allow', pattern: '**/' },
        ],
      },
    });
    try {
      await h.write('public.txt', 'public needle\n');
      const grep = await h.call('grep', { pattern: 'needle' });
      expect(textOf(grep)).toContain('public.txt');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 5: allowlist exec allows a chain of allowed segments', () => {
  it('runs pwd && echo hi', async () => {
    const h = await createHarness({
      config: {
        mode: 'allowlist',
        rules: [
          { kind: 'exec', action: 'allow', pattern: 'pwd' },
          { kind: 'exec', action: 'allow', pattern: 'echo *' },
        ],
      },
    });
    try {
      const result = await h.call('bash', { command: 'pwd && echo hi' });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('hi');
    } finally {
      await h.cleanup();
    }
  });

  it('still refuses a chain with one unlisted segment', async () => {
    const h = await createHarness({ config: { mode: 'allowlist', rules: [{ kind: 'exec', action: 'allow', pattern: 'pwd' }] } });
    try {
      const result = await h.call('bash', { command: 'pwd && echo hi' });
      expect(result.isError).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: zero-context insertions apply', () => {
  it('inserts at the header line', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'alpha\nbeta\n');
      const patch = ['--- a/a.txt', '+++ b/a.txt', '@@ -1,0 +2 @@', '+inserted', ''].join('\n');
      const result = await h.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('alpha\ninserted\nbeta\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: duplicate patch sections merge', () => {
  it('applies both updates to the same file', async () => {
    const h = await createHarness();
    try {
      await h.write('a.txt', 'one\ntwo\nthree\n');
      const patch = ['--- a/a.txt', '+++ b/a.txt', '@@ -1,1 +1,1 @@', '-one', '+ONE', '', '--- a/a.txt', '+++ b/a.txt', '@@ -3,1 +3,1 @@', '-three', '+THREE', ''].join('\n');
      const result = await h.call('apply_patch', { patch });
      expect(result.isError).toBeUndefined();
      expect(await readFile(h.file('a.txt'), 'utf-8')).toBe('ONE\ntwo\nTHREE\n');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: the read fence fires under Pi', () => {
  it('refuses a write after an external change', async () => {
    const h = await createHarness();
    try {
      await h.write('target.txt', 'ORIGINAL\n');
      await h.call('read', { path: 'target.txt' });
      await writeFile(h.file('target.txt'), 'OWNED\n', 'utf-8');
      const result = await h.call('write', { path: 'target.txt', content: 'MINE\n' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('changed on disk');
      expect(await readFile(h.file('target.txt'), 'utf-8')).toBe('OWNED\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses an edit after an external change', async () => {
    const h = await createHarness();
    try {
      await h.write('target.txt', 'ORIGINAL\n');
      await h.call('read', { path: 'target.txt' });
      await writeFile(h.file('target.txt'), 'OWNED\n', 'utf-8');
      const result = await h.call('edit', { path: 'target.txt', edits: [{ oldText: 'ORIGINAL', newText: 'MINE' }] });
      expect(result.isError).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 9: read footer matches what Pi returned', () => {
  it('reports the shown range on a truncated read', async () => {
    const h = await createHarness();
    try {
      await h.write('big.txt', Array.from({ length: 6000 }, (_, index) => `line ${index + 1}`).join('\n'));
      const result = await h.call('read', { path: 'big.txt', limit: 6000 });
      expect(textOf(result)).toContain('[file: 6000 lines');
      expect(textOf(result)).toContain('lines 1-2000');
    } finally {
      await h.cleanup();
    }
  });

  it('reports the negative-limit slice truthfully', async () => {
    const h = await createHarness();
    try {
      await h.write('five.txt', 'l1\nl2\nl3\nl4\nl5\n');
      const result = await h.call('read', { path: 'five.txt', limit: -2 });
      expect(textOf(result)).toContain('lines 1-4');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 10: grep reports no matches past the offset and names a file root', () => {
  it('reports no matches when offset is past the match count', async () => {
    const h = await createHarness();
    try {
      await h.write('hits.txt', 'hit\nhit\nhit\n');
      const result = await h.call('grep', { pattern: 'hit', path: 'hits.txt', offset: 5 });
      expect(textOf(result)).toContain('No matches found');
    } finally {
      await h.cleanup();
    }
  });

  it('labels a file search root by name', async () => {
    const h = await createHarness();
    try {
      await h.write('src/app.ts', 'const needle = 1;\n');
      const result = await h.call('grep', { pattern: 'needle', path: 'src/app.ts' });
      expect(textOf(result)).toContain('app.ts:1:');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 11: ls refuses an ignored root', () => {
  it('refuses like grep and find', async () => {
    const h = await createHarness();
    try {
      await h.write('.gitignore', 'secretdir/\n');
      await h.write('secretdir/inside.txt', 'x\n');
      const result = await h.call('ls', { path: 'secretdir' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('filtered out by .gitignore');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 12: malformed env rules surface as errors', () => {
  it('records an error instead of silently dropping the rule', async () => {
    const h = await createHarness({ env: { PI_TOOLS_RULES: 'read:denny:**/secret.txt' } });
    try {
      const session = await (await import('../src/core/session.ts')).createSession({ cwd: h.workspace, agentDir: h.agentDir, home: h.root, projectTrusted: true, env: { PI_TOOLS_RULES: 'read:denny:**/secret.txt' } });
      expect(session.config.rules?.length ?? 0).toBe(0);
      expect(session.configErrors.length).toBeGreaterThan(0);
      expect(session.configErrors[0]).toContain('PI_TOOLS_RULES');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 13: every schema is checked for missing and wrong-typed fields', () => {
  it('rejects a wrong-typed required field on every tool', async () => {
    const { validateToolArguments } = await import('@earendil-works/pi-ai/utils/validation');
    const h = await createHarness();
    try {
      const invalid: Record<string, Record<string, unknown>> = {
        read: { path: { nested: true } },
        ls: { path: { nested: true } },
        find: { pattern: { nested: true } },
        grep: { pattern: { nested: true } },
        write: { content: { nested: true } },
        edit: { path: { nested: true } },
        bash: { command: { nested: true } },
        delete: { path: { nested: true } },
        apply_patch: { patch: { nested: true } },
        git: { subcommand: { nested: true } },
        web_fetch: { url: { nested: true } },
        web_search: { query: { nested: true } },
        save_resource: { path: { nested: true } },
        search_tools: { query: { nested: true } },
      };
      for (const [name, args] of Object.entries(invalid)) {
        const tool = h.tool(name as never);
        expect(() => validateToolArguments(tool as never, { id: 'c', name, arguments: args } as never), `${name} must reject wrong type`).toThrow();
      }
    } finally {
      await h.cleanup();
    }
  });

  it('rejects a missing required field on every tool', async () => {
    const { validateToolArguments } = await import('@earendil-works/pi-ai/utils/validation');
    const h = await createHarness();
    try {
      const missing: Record<string, Record<string, unknown>> = {
        read: {},
        find: {},
        grep: {},
        write: { path: 'x' },
        edit: { path: 'x' },
        bash: {},
        delete: {},
        apply_patch: {},
        git: {},
        web_fetch: {},
        web_search: {},
        save_resource: {},
        search_tools: {},
      };
      for (const [name, args] of Object.entries(missing)) {
        const tool = h.tool(name as never);
        expect(() => validateToolArguments(tool as never, { id: 'c', name, arguments: args } as never), `${name} must reject missing required field`).toThrow();
      }
    } finally {
      await h.cleanup();
    }
  });
});

describe('authorization unit coverage', () => {
  it('decides outside workspace calls according to mode', () => {
    const policy = createPolicy({ cwd: '/repo', mode: 'auto' });
    expect(decide(policy, 'read', '/repo/x', { canPrompt: false }).kind).toBe('allow');
    expect(decide(policy, 'read', '/elsewhere/x', { canPrompt: false }).kind).toBe('deny');
    expect(decide(policy, 'read', '/elsewhere/x', { canPrompt: true }).kind).toBe('approve');
  });
});
