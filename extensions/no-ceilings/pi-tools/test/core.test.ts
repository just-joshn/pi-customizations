import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.ts';
import { parseIgnorePatterns } from '../src/core/ignore.ts';
import { expandHome, isInside, relativeTo, resolveToolPath, stripAtPrefix, toPosix } from '../src/core/paths.ts';
import { createPolicy, decide, isInsideWorkspace, ruleMatches } from '../src/core/policy.ts';
import { countLines, countOccurrences, detectEol, looksBinary, normalizeEol, sha256Hex, stripBom, toEol } from '../src/core/text.ts';
import { createHarness } from './harness.ts';

const HOME = '/home/tester';
const CWD = '/repo/app';

describe('paths', () => {
  it('strips the @ prefix models add', () => {
    expect(stripAtPrefix('@src/index.ts')).toBe('src/index.ts');
    expect(stripAtPrefix('src/index.ts')).toBe('src/index.ts');
  });

  it('expands ~ and ~/ to the home directory', () => {
    expect(expandHome('~', HOME)).toBe(HOME);
    expect(expandHome('~/notes', HOME)).toBe('/home/tester/notes');
    expect(expandHome('a/~/b', HOME)).toBe('a/~/b');
  });

  it('resolves relative, absolute, and file URL inputs', () => {
    expect(resolveToolPath('src/a.ts', CWD, HOME)).toBe('/repo/app/src/a.ts');
    expect(resolveToolPath('/etc/hosts', CWD, HOME)).toBe('/etc/hosts');
    expect(resolveToolPath('file:///tmp/x.txt', CWD, HOME)).toBe('/tmp/x.txt');
    expect(resolveToolPath('~/x.txt', CWD, HOME)).toBe('/home/tester/x.txt');
    expect(resolveToolPath('@src/b.ts', CWD, HOME)).toBe('/repo/app/src/b.ts');
  });

  it('rejects empty paths and invalid file URLs', () => {
    expect(() => resolveToolPath('   ', CWD, HOME)).toThrow('path is empty or only whitespace');
    expect(() => resolveToolPath('file://host/%zz', CWD, HOME)).toThrow('is not a valid file URL');
  });

  it('computes containment and relative paths', () => {
    expect(isInside('/repo', '/repo/app/x')).toBe(true);
    expect(isInside('/repo', '/repository')).toBe(false);
    expect(isInside('/repo', '/repo')).toBe(true);
    expect(relativeTo('/repo', '/repo/app/x')).toBe('app/x');
    expect(relativeTo('/repo', '/other/x')).toBe('/other/x');
    expect(toPosix('a/b')).toBe('a/b');
  });
});

describe('text helpers', () => {
  it('separates a byte order mark', () => {
    expect(stripBom('\uFEFFhello')).toEqual({ bom: '\uFEFF', text: 'hello' });
    expect(stripBom('hello')).toEqual({ bom: '', text: 'hello' });
  });

  it('detects and rewrites line endings', () => {
    expect(detectEol('a\r\nb\r\nc')).toBe('\r\n');
    expect(detectEol('a\nb\nc')).toBe('\n');
    expect(normalizeEol('a\r\nb')).toBe('a\nb');
    expect(toEol('a\nb', '\r\n')).toBe('a\r\nb');
    expect(toEol('a\nb', '\n')).toBe('a\nb');
  });

  it('counts lines like an editor', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('one')).toBe(1);
    expect(countLines('one\n')).toBe(1);
    expect(countLines('one\ntwo')).toBe(2);
    expect(countLines('one\r\ntwo\r\n')).toBe(2);
  });

  it('detects binary content', () => {
    expect(looksBinary(Buffer.from([0x00, 0x01]))).toBe(true);
    expect(looksBinary(Buffer.from('plain text with a tab\there'))).toBe(false);
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });

  it('counts occurrences and hashes content', () => {
    expect(countOccurrences('a-a-a', 'a')).toBe(3);
    expect(countOccurrences('abc', '')).toBe(0);
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('policy', () => {
  const policy = createPolicy({
    cwd: CWD,
    home: HOME,
    mode: 'auto',
    rules: [
      { kind: 'read', action: 'deny', pattern: '**/.env' },
      { kind: 'write', action: 'deny', pattern: '**/secrets/**' },
      { kind: 'exec', action: 'deny', pattern: 'rm -rf *' },
      { kind: 'read', action: 'allow', pattern: '**/public/**' },
    ],
  });

  it('denies by rule before mode logic', () => {
    expect(decide(policy, 'read', '/repo/app/.env', { canPrompt: true }).kind).toBe('deny');
    expect(decide(policy, 'exec', 'rm -rf node_modules', { canPrompt: true }).kind).toBe('deny');
  });

  it('honors allow rules and workspace containment', () => {
    expect(decide(policy, 'read', '/repo/app/src/a.ts', { canPrompt: false }).kind).toBe('allow');
    expect(decide(policy, 'write', '/tmp/out.txt', { canPrompt: false }).kind).toBe('deny');
    expect(decide(policy, 'write', '/tmp/out.txt', { canPrompt: true }).kind).toBe('approve');
  });

  it('restricts allowlist mode to allow rules', () => {
    const strict = createPolicy({ cwd: CWD, home: HOME, mode: 'allowlist', rules: [{ kind: 'read', action: 'allow', pattern: '**/public/**' }] });
    expect(decide(strict, 'read', '/repo/app/public/x', { canPrompt: true }).kind).toBe('allow');
    expect(decide(strict, 'read', '/repo/app/src/x', { canPrompt: true }).kind).toBe('deny');
  });

  it('applies deny rules only in unrestricted mode', () => {
    const open = createPolicy({ cwd: CWD, home: HOME, mode: 'unrestricted', rules: [{ kind: 'write', action: 'deny', pattern: '**/secrets/**' }] });
    expect(decide(open, 'write', '/repo/app/secrets/key', { canPrompt: false }).kind).toBe('deny');
    expect(decide(open, 'write', '/elsewhere/x', { canPrompt: false }).kind).toBe('allow');
  });

  it('matches basename patterns at any depth and command patterns literally', () => {
    expect(ruleMatches({ kind: 'read', action: 'deny', pattern: '.env' }, '/repo/app/.env', policy)).toBe(true);
    expect(ruleMatches({ kind: 'exec', action: 'deny', pattern: 'npm test' }, 'npm test', policy)).toBe(true);
    expect(ruleMatches({ kind: 'exec', action: 'deny', pattern: 'npm test' }, 'npm test -- --watch', policy)).toBe(false);
  });

  it('detects workspace containment across roots', () => {
    const multi = createPolicy({ cwd: CWD, home: HOME, workspaceRoots: ['/repo/a', '/repo/b'] });
    expect(isInsideWorkspace(multi, '/repo/b/x')).toBe(true);
    expect(isInsideWorkspace(multi, '/repo/c/x')).toBe(false);
  });
});

describe('ignore parsing', () => {
  it('skips comments and blank lines, including CRLF input', () => {
    const matcher = parseIgnorePatterns('# comment\r\n\r\nbuild/\r\n*.log\r\n!keep.log\r\n');
    expect(matcher.ignores('build/x.js')).toBe(true);
    expect(matcher.ignores('a.log')).toBe(true);
    expect(matcher.ignores('keep.log')).toBe(false);
    expect(matcher.ignores('src/a.ts')).toBe(false);
  });

  it('honors ignore files in search and listing, and refuses an explicit ignored path', async () => {
    const harness = await createHarness();
    try {
      await harness.write('.piignore', 'secret/\n*.tmp\n');
      await harness.write('secret/hidden.txt', 'needle\n');
      await harness.write('visible.txt', 'needle\n');
      await harness.write('scratch.tmp', 'needle\n');

      const grep = await harness.call('grep', { pattern: 'needle' });
      expect(grep.content[0]?.type === 'text' ? grep.content[0].text : '').toContain('visible.txt');
      expect(grep.content[0]?.type === 'text' ? grep.content[0].text : '').not.toContain('scratch.tmp');

      const listing = await harness.call('ls', {});
      expect(JSON.stringify(listing.content)).not.toContain('scratch.tmp');

      const explicit = await harness.call('read', { path: 'scratch.tmp' });
      expect(explicit.isError).toBe(true);
      expect(explicit.content[0]?.type === 'text' ? explicit.content[0].text : '').toContain('filtered out by .piignore');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('configuration', () => {
  it('merges user, project, and environment rules with environment mode override', async () => {
    const harness = await createHarness({
      config: { mode: 'allowlist', rules: [{ kind: 'read', action: 'deny', pattern: '**/project-secret' }] },
      env: { PI_TOOLS_MODE: 'auto', PI_TOOLS_RULES: 'exec:deny:npm publish*' },
    });
    try {
      await mkdir(path.join(harness.agentDir), { recursive: true });
      await writeFile(
        path.join(harness.agentDir, 'pi-tools.json'),
        JSON.stringify({
          rules: [
            { kind: 'read', action: 'deny', pattern: '**/user-secret' },
            { kind: 'write', action: 'deny', pattern: '**/user-write' },
          ],
        }),
        'utf-8',
      );
      const loaded = await loadConfig({ cwd: harness.workspace, home: harness.root, agentDir: harness.agentDir, projectTrusted: true, env: { PI_TOOLS_MODE: 'auto', PI_TOOLS_RULES: 'exec:deny:npm publish*' } });
      expect(loaded.policy.mode).toBe('auto');
      expect(loaded.policy.rules.map((rule) => `${rule.kind}:${rule.action}:${rule.pattern}`)).toEqual(['read:deny:**/user-secret', 'write:deny:**/user-write', 'read:deny:**/project-secret', 'exec:deny:npm publish*']);
      expect(loaded.sources).toHaveLength(2);
      expect(loaded.errors).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it('reports malformed configuration without failing the session', async () => {
    const harness = await createHarness();
    try {
      await mkdir(path.join(harness.workspace, '.pi'), { recursive: true });
      await writeFile(path.join(harness.workspace, '.pi', 'pi-tools.json'), '{ not json', 'utf-8');
      const loaded = await loadConfig({ cwd: harness.workspace, home: harness.root, agentDir: harness.agentDir, projectTrusted: true });
      expect(loaded.errors).toHaveLength(1);
      expect(loaded.policy.mode).toBe('auto');
    } finally {
      await harness.cleanup();
    }
  });

  it('ignores project configuration when the project is untrusted', async () => {
    const harness = await createHarness({ config: { mode: 'allowlist' } });
    try {
      const loaded = await loadConfig({ cwd: harness.workspace, home: harness.root, agentDir: harness.agentDir, projectTrusted: false });
      expect(loaded.policy.mode).toBe('auto');
      expect(loaded.sources).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });
});
