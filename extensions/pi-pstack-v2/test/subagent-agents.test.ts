import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { says } from './subagent-child-output.ts';
import { fakeTmux } from './subagent-fake-tmux.ts';
import { loadSubagent, makeCtx, textOf, useWorkspace, writeAgent } from './subagent-host.ts';

vi.mock('node:child_process', () => import('./subagent-fake-tmux.ts'));

const workspace = useWorkspace();
const BUNDLED = ['ci-watcher', 'comment-sicko', 'poteto-agent', 'scout', 'thermo-nuclear-code-quality-review', 'worker'];
const WORKER_TOOLS = 'read,grep,find,ls,bash,edit,write';

type Scope = 'user' | 'project' | 'both';

/** The agents a call can see, as the tool lists them when it is given no mode: `name (source)`. */
async function listed(scope: Scope, cwd = workspace().project): Promise<string[]> {
  const result = await loadSubagent().call({ agentScope: scope }, makeCtx(cwd));
  const [, names = ''] = textOf(result).split('Available agents: ');
  return names.split(', ').filter((entry) => !entry.endsWith('(package)'));
}

const runAgent = (name: string, params: Record<string, unknown> = {}) => loadSubagent().call({ agent: name, task: 'go', ...params }, makeCtx(workspace().project));
const write = (file: string, content: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const projectAgents = () => path.join(workspace().project, '.pi', 'agents');

describe('reading an agent definition', () => {
  test.for([
    ['a comma separated string', 'tools: read, bash\n', 'read,bash'],
    ['an array that holds a number and padded names', 'tools: [read, " grep ", 3]\n', 'read,grep'],
    ['a number', 'tools: 5\n', undefined],
    ['only commas and blanks', 'tools: " , "\n', undefined],
    ['no tools key', '', undefined],
  ])('gives the child the tools it reads from %s', async ([, frontmatter, expected]) => {
    writeAgent(workspace().userAgents, 'custom', frontmatter);
    await runAgent('custom');
    expect(fakeTmux.children()[0]?.flag('--tools')).toBe(expected);
  });

  test('ignores a model that is not a string and keeps the session default', async () => {
    writeAgent(workspace().userAgents, 'custom', 'model: 7\n');
    await loadSubagent().call({ agent: 'custom', task: 'go' }, makeCtx(workspace().project, { model: { provider: 'p', id: 'm' } }));
    expect(fakeTmux.children()[0]?.flag('--model')).toBe('p/m');
  });

  test('sends the markdown body to the child as its system prompt', async () => {
    writeAgent(workspace().userAgents, 'custom', '', 'You are custom.');
    let prompt = '';
    fakeTmux.onChild((child) => {
      prompt = fs.readFileSync(child.flag('--append-system-prompt') ?? '', 'utf8');
      says('ok')(child);
    });
    await runAgent('custom');
    expect(prompt).toContain('You are custom.');
  });
});

describe('reading an agent definition, which files count', () => {
  test('skips files that are not valid agents and keeps the valid ones', async () => {
    const dir = workspace().userAgents;
    write(path.join(dir, 'notes.txt'), '---\nname: txt\ndescription: d\n---\n');
    write(path.join(dir, 'missing-description.md'), '---\nname: only\n---\nbody');
    write(path.join(dir, 'plain.md'), 'no frontmatter');
    write(path.join(dir, 'numeric-name.md'), '---\nname: 5\ndescription: d\n---\n');
    write(path.join(dir, 'a-list.md'), '---\n- name\n- description\n---\n');
    fs.mkdirSync(path.join(dir, 'folder.md'));
    writeAgent(dir, 'ok');
    expect(await listed('user')).toEqual(['ok (user)']);
  });

  test('follows a symlinked agent file and ignores a broken link', async () => {
    const dir = workspace().userAgents;
    const target = write(path.join(workspace().root, 'elsewhere.md'), '---\nname: linked\ndescription: d\n---\nbody');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(target, path.join(dir, 'linked.md'));
    fs.symlinkSync(path.join(workspace().root, 'missing.md'), path.join(dir, 'broken.md'));
    expect(await listed('user')).toEqual(['linked (user)']);
  });

  test('lists no user agents when the agents directory is missing or is a file', async () => {
    expect(await listed('user')).toEqual([]);
    write(workspace().userAgents, 'a file, not a dir');
    expect(await listed('user')).toEqual([]);
  });
});

describe('where agents are found', () => {
  test('walks up from the working directory to the nearest project agents directory', async () => {
    writeAgent(workspace().userAgents, 'mine');
    writeAgent(projectAgents(), 'repo');
    const deep = path.join(workspace().project, 'sub', 'deep');
    fs.mkdirSync(deep, { recursive: true });
    expect(await listed('project', deep)).toEqual(['repo (project)']);
  });

  test('the user scope ignores project agents, and the project scope ignores user agents', async () => {
    writeAgent(workspace().userAgents, 'mine');
    writeAgent(projectAgents(), 'repo');
    expect(await listed('user')).toEqual(['mine (user)']);
    expect(await listed('project')).toEqual(['repo (project)']);
  });

  test('the both scope lists user and project agents, with the project one winning a name clash', async () => {
    writeAgent(workspace().userAgents, 'same', '', 'user body');
    writeAgent(workspace().userAgents, 'only');
    writeAgent(projectAgents(), 'same', '', 'project body');
    expect((await listed('both')).toSorted()).toEqual(['only (user)', 'same (project)']);
  });

  test('finds project agents from the directory a task runs in', async () => {
    const other = path.join(workspace().project, 'other');
    writeAgent(path.join(other, '.pi', 'agents'), 'local');
    const result = await loadSubagent().call({ agent: 'local', task: 'go', cwd: 'other', agentScope: 'project' }, makeCtx(workspace().project));
    expect(textOf(result)).toBe('done');
    expect(fakeTmux.children()[0]?.cwd).toBe(other);
  });
});

describe('the agents the package ships', () => {
  test('lists them next to the user agents, and a user agent of the same name replaces one', async () => {
    const result = await loadSubagent().call({}, makeCtx(workspace().project));
    expect(textOf(result)).toContain(`Available agents: ${BUNDLED.map((name) => `${name} (package)`).join(', ')}`);
    writeAgent(workspace().userAgents, 'poteto-agent');
    expect(await listed('user')).toEqual(['poteto-agent (user)']);
  });

  test('poteto-agent carries the poteto prompt', async () => {
    let prompt = '';
    fakeTmux.onChild((child) => {
      prompt = fs.readFileSync(child.flag('--append-system-prompt') ?? '', 'utf8');
      says('ok')(child);
    });
    await runAgent('poteto-agent');
    expect(prompt).toContain('Poteto subagent');
  });

  test('worker has every editing tool and no system prompt, so only its task steers it', async () => {
    await runAgent('worker');
    const [child] = fakeTmux.children();
    expect(child?.flag('--tools')).toBe(WORKER_TOOLS);
    expect(child?.args).not.toContain('--append-system-prompt');
  });

  test('no bundled prompt sends the model to a Cursor path that does not exist under Pi', async () => {
    let prompts: readonly string[] = [];
    fakeTmux.onChild((child) => {
      const file = child.flag('--append-system-prompt');
      if (file) prompts = [...prompts, fs.readFileSync(file, 'utf8')];
      says('ok')(child);
    });
    for (const name of BUNDLED) await runAgent(name);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.filter((prompt) => /~\/\.cursor|\.cursor-plugin/.test(prompt))).toEqual([]);
  });
});

const approval = (overrides: Parameters<typeof makeCtx>[1] = {}) => ({ hasUI: true, trusted: false, ...overrides });
const callLocal = (params: Record<string, unknown>, options: Parameters<typeof makeCtx>[1]) => loadSubagent().call({ agent: 'local', task: 'go', agentScope: 'both', ...params }, makeCtx(workspace().project, options));
const noAsk: [string, Parameters<typeof makeCtx>[1], Record<string, unknown>][] = [
  ['the project is trusted', { hasUI: true, trusted: true }, {}],
  ['confirmation is turned off', { hasUI: true, trusted: false }, { confirmProjectAgents: false }],
  ['no one is there to ask', { hasUI: false, trusted: false }, {}],
];

describe('approving project agents', () => {
  test('asks in the UI, naming the agent file, and cancels when the user refuses', async () => {
    const file = writeAgent(projectAgents(), 'local');
    const confirm = vi.fn(async () => false);
    const result = await callLocal({}, approval({ confirm }));
    expect(textOf(result)).toBe('Canceled: project-local agents not approved.');
    expect(confirm).toHaveBeenCalledWith('Run project-local agents?', expect.stringContaining(`- local: ${file}`));
    expect(fakeTmux.children()).toHaveLength(0);
  });

  test('runs the project agent once the user approves', async () => {
    writeAgent(projectAgents(), 'local');
    const confirm = vi.fn(async () => true);
    expect(textOf(await callLocal({ agentScope: 'project' }, approval({ confirm })))).toBe('done');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test('asks once per agent file even when several tasks use it', async () => {
    writeAgent(projectAgents(), 'local');
    const confirm = vi.fn(async () => true);
    const tasks = [1, 2].map((n) => ({ agent: 'local', task: `t${n}` }));
    await callLocal({ agent: undefined, task: undefined, tasks }, approval({ confirm }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe('approving project agents, when it does not ask', () => {
  test.for(noAsk)('does not ask when %s', async ([, options, params]) => {
    writeAgent(projectAgents(), 'local');
    const confirm = vi.fn(async () => false);
    expect(textOf(await callLocal(params, { ...options, confirm }))).toBe('done');
    expect(confirm).not.toHaveBeenCalled();
  });

  test('does not ask about user agents or when the scope is user', async () => {
    writeAgent(workspace().userAgents, 'local');
    writeAgent(projectAgents(), 'other');
    const confirm = vi.fn(async () => false);
    expect(textOf(await callLocal({}, approval({ confirm, trusted: true })))).toBe('done');
    expect(textOf(await callLocal({ agentScope: 'user' }, approval({ confirm })))).toBe('done');
    expect(confirm).not.toHaveBeenCalled();
  });

  test.for([
    ['the working directory has no agents of its own', false],
    ['the working directory has other project agents', true],
  ])('asks even in a trusted project for an agent from another directory when %s', async ([, hasOwn]) => {
    if (hasOwn) writeAgent(projectAgents(), 'unrelated');
    const otherAgents = path.join(workspace().project, 'other', '.pi', 'agents');
    writeAgent(otherAgents, 'local');
    const confirm = vi.fn(async () => false);
    const result = await callLocal({ cwd: 'other' }, { hasUI: true, trusted: true, confirm });
    expect(textOf(result)).toBe('Canceled: project-local agents not approved.');
    expect(confirm).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(path.join(otherAgents, 'local.md')));
  });
});
