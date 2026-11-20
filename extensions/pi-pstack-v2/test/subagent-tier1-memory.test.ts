import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test } from 'vitest';
import { says } from './subagent-child-output.ts';
import { type FakeChild, fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, textOf, useWorkspace, writeAgent } from './subagent-host.ts';

const workspace = useWorkspace();
const MEMORY_ENV = 'PI_SUBAGENT_MEMORY_DIR';
const PRIVATE_MODE = 0o700;
const MODE_BITS = 0o777;
const MAX_LINES = 200;
const MAX_CHARS = 25_000;
const OVERSIZED_CHARS = 2_000_000;
const SCOPES = ['user', 'project', 'local'] as const;

type Scope = (typeof SCOPES)[number];
type Seen = { child: FakeChild; prompt: string };

const memoryDirOf = (scope: Scope, name = 'custom'): string => {
  const { root, project } = workspace();
  if (scope === 'user') return path.join(root, 'agent', 'agent-memory', name);
  return path.join(project, '.pi', scope === 'project' ? 'agent-memory' : 'agent-memory-local', name);
};

/** Scripts the child to read the system prompt file it was given before it answers, since the file goes away on exit. */
const watchChild = (): (() => Seen | undefined) => {
  let seen: Seen | undefined;
  fakePi.onChild((child) => {
    const promptFile = child.flag('--append-system-prompt');
    seen = { child, prompt: promptFile ? fs.readFileSync(promptFile, 'utf8') : '' };
    says('ok')(child);
  });
  return () => seen;
};

const run = async (frontmatter: string) => {
  writeAgent(workspace().userAgents, 'custom', frontmatter, 'You are custom.');
  const seen = watchChild();
  const result = await loadSubagent().call({ agent: 'custom', task: 'look' }, makeCtx(workspace().project));
  return { result, seen: seen() };
};

const writeMemory = (scope: Scope, content: string): void => {
  fs.mkdirSync(memoryDirOf(scope), { recursive: true });
  fs.writeFileSync(path.join(memoryDirOf(scope), 'MEMORY.md'), content);
};

describe('agent memory directories', () => {
  test.for(SCOPES)('the %s scope creates a private directory for the agent', async (scope) => {
    await run(`memory: ${scope}\n`);
    expect(fs.statSync(memoryDirOf(scope)).isDirectory()).toBe(true);
    expect(fs.statSync(memoryDirOf(scope)).mode & MODE_BITS).toBe(PRIVATE_MODE);
  });

  test('an agent name is made safe before it names a directory', async () => {
    writeAgent(workspace().userAgents, 'my.agent', 'memory: user\n');
    await loadSubagent().call({ agent: 'my.agent', task: 'look' }, makeCtx(workspace().project));
    expect(fs.statSync(memoryDirOf('user', 'my-agent')).isDirectory()).toBe(true);
  });

  test.for(['bogus', '"yes"', 'true'])('ignores a memory of %s, so nothing is created or added', async (value) => {
    const { seen } = await run(`memory: ${value}\n`);
    expect(seen?.prompt.trim()).toBe('You are custom.');
    expect(fs.existsSync(path.join(workspace().root, 'agent', 'agent-memory'))).toBe(false);
    expect(fs.existsSync(path.join(workspace().project, '.pi'))).toBe(false);
  });

  test('an agent without memory gets no memory directory or variable', async () => {
    const { seen } = await run('');
    expect(seen?.child.env[MEMORY_ENV]).toBeUndefined();
  });
});

describe('agent memory in the system prompt', () => {
  test.for(SCOPES)('loads the %s MEMORY.md after the agent prompt, with the directory', async (scope) => {
    writeMemory(scope, 'Prefer tabs.\n');
    const { seen } = await run(`memory: ${scope}\n`);
    expect(seen?.prompt.startsWith('You are custom.')).toBe(true);
    expect(seen?.prompt).toContain(`Persistent agent memory (${scope})`);
    expect(seen?.prompt).toContain(memoryDirOf(scope));
    expect(seen?.prompt).toContain('Prefer tabs.');
  });

  test('says so when there is no MEMORY.md yet', async () => {
    const { seen } = await run('memory: user\n');
    expect(seen?.prompt).toContain('MEMORY.md is currently empty');
  });

  test('loads only the first 200 lines of a long MEMORY.md', async () => {
    writeMemory('user', Array.from({ length: MAX_LINES + MAX_LINES }, (_, index) => `note-${index}`).join('\n'));
    const { seen } = await run('memory: user\n');
    expect(seen?.prompt).toContain(`note-${MAX_LINES - 1}\n`);
    expect(seen?.prompt).not.toContain(`note-${MAX_LINES}\n`);
    expect(seen?.prompt).toContain('truncated');
  });

  test('loads only the first 25000 characters of an oversized MEMORY.md', async () => {
    writeMemory('user', 'x'.repeat(OVERSIZED_CHARS));
    const { seen } = await run('memory: user\n');
    expect(seen?.prompt).toContain('x'.repeat(MAX_CHARS));
    expect(seen?.prompt).not.toContain('x'.repeat(MAX_CHARS + 1));
    expect(seen?.prompt).toContain('truncated');
  });
});

describe('agent memory tools and environment', () => {
  test.for([
    ['tools: grep\n', 'grep,read,write,edit'],
    ['tools: read, bash\n', 'read,bash,write,edit'],
    ['tools: [grep, Edit]\n', 'grep,Edit,read,write'],
    ['tools: grep\ndisallowedTools: edit\n', 'grep,read,write'],
  ] as const)('with %j the child gets the tools %s', async ([tools, expected]) => {
    const { seen } = await run(`memory: user\n${tools}`);
    expect(seen?.child.flag('--tools')).toBe(expected);
  });

  test('an agent that names no tools keeps Pi defaults, which already include the memory tools', async () => {
    const { seen } = await run('memory: user\n');
    expect(seen?.child.args).not.toContain('--tools');
  });

  test('an agent without memory keeps exactly the tools it names', async () => {
    const { seen } = await run('tools: grep\n');
    expect(seen?.child.flag('--tools')).toBe('grep');
  });

  test('the user scope tells the child its memory directory, so its VM can mount it', async () => {
    const { seen } = await run('memory: user\n');
    expect(seen?.child.env[MEMORY_ENV]).toBe(memoryDirOf('user'));
  });

  test.for(['project', 'local'] as const)('the %s scope lives in the workspace and sets no variable', async (scope) => {
    const { seen } = await run(`memory: ${scope}\n`);
    expect(seen?.child.env[MEMORY_ENV]).toBeUndefined();
  });
});

describe('agent memory refuses unsafe files', () => {
  const unsafe = async (scope: Scope) => {
    const { result, seen } = await run(`memory: ${scope}\n`);
    expect(seen).toBeUndefined();
    expect(result.details?.isError).toBe(true);
    return textOf(result);
  };

  test.for(SCOPES)('a symlinked MEMORY.md in the %s scope is refused, and its target is never read', async (scope) => {
    const secret = path.join(workspace().root, 'secret.txt');
    fs.writeFileSync(secret, 'top secret');
    fs.mkdirSync(memoryDirOf(scope), { recursive: true });
    fs.symlinkSync(secret, path.join(memoryDirOf(scope), 'MEMORY.md'));
    const text = await unsafe(scope);
    expect(text).toMatch(/MEMORY\.md/);
    expect(text).not.toContain('top secret');
  });

  test('a symlinked memory directory is refused', async () => {
    const elsewhere = path.join(workspace().root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(memoryDirOf('project')), { recursive: true });
    fs.symlinkSync(elsewhere, memoryDirOf('project'));
    expect(await unsafe('project')).toMatch(/not a real directory/);
  });
});
