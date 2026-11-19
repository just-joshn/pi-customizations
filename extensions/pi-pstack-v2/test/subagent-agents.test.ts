import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { projectAgentsApproved, resolveAgent } from '../src/subagent/agent-resolution.ts';
import { type AgentConfig, discoverAgents, formatAgentList } from '../src/subagent/agents.ts';
import type { ResolvedAgent } from '../src/subagent/types.ts';

const AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';
const TWO = 2;

let root = '';
let userHome = '';
let project = '';

const write = (file: string, content: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const agentMd = (name: string, extra = 'tools: read\n', body = 'You are helpful.') => `---\nname: ${name}\ndescription: does ${name}\n${extra}---\n${body}\n`;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-')));
  userHome = path.join(root, 'home');
  project = path.join(root, 'proj');
  fs.mkdirSync(path.join(project, 'sub', 'deep'), { recursive: true });
  vi.stubEnv(AGENT_DIR_ENV, userHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('discoverAgents', () => {
  test('reads user agents with parsed tools, model and prompt body', () => {
    write(path.join(userHome, 'agents', 'a.md'), agentMd('a', 'tools: read, bash\nmodel: m1\n'));
    const { agents, projectAgentsDir } = discoverAgents(project, 'user');
    expect(projectAgentsDir).toBeNull();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ name: 'a', description: 'does a', tools: ['read', 'bash'], model: 'm1', source: 'user', systemPrompt: 'You are helpful.' });
  });

  test('accepts array tools and drops unusable tools or model values', () => {
    write(path.join(userHome, 'agents', 'arr.md'), agentMd('arr', 'tools: [read, " grep ", 3]\n'));
    write(path.join(userHome, 'agents', 'num.md'), agentMd('num', 'tools: 5\nmodel: 7\n'));
    write(path.join(userHome, 'agents', 'empty.md'), agentMd('empty', 'tools: " , "\n'));
    const byName = Object.fromEntries(discoverAgents(project, 'user').agents.map((a) => [a.name, a]));
    expect(byName['arr']?.tools).toEqual(['read', 'grep']);
    expect(byName['num']?.tools).toBeUndefined();
    expect(byName['num']?.model).toBeUndefined();
    expect(byName['empty']?.tools).toBeUndefined();
  });

  test('reads an agent whose frontmatter has no tools key, with tools and model unset', () => {
    write(path.join(userHome, 'agents', 'notools.md'), agentMd('notools', ''));
    const [agent] = discoverAgents(project, 'user').agents;
    expect(agent).toMatchObject({ name: 'notools', description: 'does notools', systemPrompt: 'You are helpful.' });
    expect(Object.keys(agent ?? {})).toEqual(['name', 'description', 'tools', 'model', 'systemPrompt', 'source', 'filePath']);
    expect(agent?.tools).toBeUndefined();
    expect(agent?.model).toBeUndefined();
  });

  test('skips non-markdown files, directories, and files missing required frontmatter', () => {
    const dir = path.join(userHome, 'agents');
    write(path.join(dir, 'notes.txt'), agentMd('txt'));
    write(path.join(dir, 'bad.md'), '---\nname: only\n---\nbody');
    write(path.join(dir, 'plain.md'), 'no frontmatter');
    fs.mkdirSync(path.join(dir, 'folder.md'));
    write(path.join(dir, 'ok.md'), agentMd('ok'));
    expect(discoverAgents(project, 'user').agents.map((a) => a.name)).toEqual(['ok']);
  });

  test('follows symlinked agent files and ignores unreadable broken links', () => {
    const dir = path.join(userHome, 'agents');
    const target = write(path.join(root, 'elsewhere.md'), agentMd('linked'));
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(target, path.join(dir, 'linked.md'));
    fs.symlinkSync(path.join(root, 'missing.md'), path.join(dir, 'broken.md'));
    expect(discoverAgents(project, 'user').agents.map((a) => a.name)).toEqual(['linked']);
  });
});

describe('discoverAgents directories', () => {
  test('returns nothing when the user agents directory is absent or unreadable as a directory', () => {
    expect(discoverAgents(project, 'user').agents).toEqual([]);
    write(path.join(userHome, 'agents'), 'a file, not a dir');
    expect(discoverAgents(project, 'user').agents).toEqual([]);
  });

  test('finds the nearest project agents dir walking up and ignores user agents under scope project', () => {
    write(path.join(userHome, 'agents', 'u.md'), agentMd('u'));
    const agentsDir = path.join(project, '.pi', 'agents');
    write(path.join(agentsDir, 'p.md'), agentMd('p'));
    const result = discoverAgents(path.join(project, 'sub', 'deep'), 'project');
    expect(result.projectAgentsDir).toBe(agentsDir);
    expect(result.agents.map((a) => [a.name, a.source])).toEqual([['p', 'project']]);
  });

  test('scope user ignores project agents but still reports the directory', () => {
    write(path.join(project, '.pi', 'agents', 'p.md'), agentMd('p'));
    const result = discoverAgents(project, 'user');
    expect(result.agents).toEqual([]);
    expect(result.projectAgentsDir).toBe(path.join(project, '.pi', 'agents'));
  });
});

describe('discoverAgents precedence', () => {
  test('under both, project agents override user agents of the same name', () => {
    write(path.join(userHome, 'agents', 'same.md'), agentMd('same', undefined, 'user body'));
    write(path.join(userHome, 'agents', 'only.md'), agentMd('only'));
    write(path.join(project, '.pi', 'agents', 'same.md'), agentMd('same', undefined, 'project body'));
    const agents = discoverAgents(project, 'both').agents;
    expect(agents.find((a) => a.name === 'same')).toMatchObject({ source: 'project', systemPrompt: 'project body' });
    expect(agents).toHaveLength(TWO);
  });
});

describe('formatAgentList', () => {
  const agent = (name: string): AgentConfig => ({ name, description: `d-${name}`, systemPrompt: '', source: 'user', filePath: `/${name}.md` });

  test('says none for an empty list', () => {
    expect(formatAgentList([], TWO)).toEqual({ text: 'none', remaining: 0 });
  });

  test('lists up to the limit and reports the remainder', () => {
    expect(formatAgentList([agent('a'), agent('b'), agent('c')], TWO)).toEqual({ text: 'a (user): d-a; b (user): d-b', remaining: 1 });
    expect(formatAgentList([agent('a')], TWO).remaining).toBe(0);
  });
});

describe('resolveAgent', () => {
  test('finds an agent by name, resolving cwd against the default', () => {
    write(path.join(userHome, 'agents', 'a.md'), agentMd('a'));
    const resolved = resolveAgent(project, 'user', 'a', 'sub');
    expect(resolved.cwd).toBe(path.join(project, 'sub'));
    expect(resolved.agent?.name).toBe('a');
    expect(resolved.available.map((a) => a.name)).toEqual(['a']);
  });

  test('leaves agent undefined for unknown names and defaults cwd', () => {
    write(path.join(userHome, 'agents', 'a.md'), agentMd('a'));
    const resolved = resolveAgent(project, 'user', 'zzz');
    expect(resolved).toMatchObject({ agent: undefined, cwd: project });
    expect(resolved.available).toHaveLength(1);
  });
});

describe('projectAgentsApproved', () => {
  const ctxFor = (trusted: boolean, confirm: (title: string, message: string) => Promise<boolean>) => ({ isProjectTrusted: () => trusted, ui: { confirm } }) as unknown as ExtensionContext;
  const selected = (...agents: (AgentConfig | undefined)[]): ResolvedAgent[] => agents.map((agent) => ({ agent, available: [], cwd: project }));

  test('approves without prompting when only user agents or none are selected', async () => {
    const confirm = vi.fn();
    write(path.join(userHome, 'agents', 'a.md'), agentMd('a'));
    const userAgent = discoverAgents(project, 'user').agents[0];
    expect(await projectAgentsApproved(ctxFor(true, confirm), selected(userAgent, undefined), null)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('approves silently for project agents inside the trusted project agents dir', async () => {
    const confirm = vi.fn();
    write(path.join(project, '.pi', 'agents', 'p.md'), agentMd('p'));
    const { agents, projectAgentsDir } = discoverAgents(project, 'project');
    expect(await projectAgentsApproved(ctxFor(true, confirm), selected(...agents), projectAgentsDir)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('asks once per file when the project is untrusted and returns the answer', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const file = write(path.join(project, '.pi', 'agents', 'p.md'), agentMd('p'));
    const { agents, projectAgentsDir } = discoverAgents(project, 'project');
    const approved = await projectAgentsApproved(ctxFor(false, confirm), selected(...agents, ...agents), projectAgentsDir);
    expect(approved).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[1]).toContain(`- p: ${file}`);
  });

  test('asks when there is no project agents dir at all, and approval passes through', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    write(path.join(project, '.pi', 'agents', 'p.md'), agentMd('p'));
    const { agents } = discoverAgents(project, 'project');
    expect(await projectAgentsApproved(ctxFor(true, confirm), selected(...agents), null)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test('asks for a project agent that lives outside the trusted dir', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    write(path.join(project, '.pi', 'agents', 'p.md'), agentMd('p'));
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    const { agents } = discoverAgents(project, 'project');
    await projectAgentsApproved(ctxFor(true, confirm), selected(...agents), other);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe('bundled agents', () => {
  test('resolves the agents the package ships, such as poteto-agent, with an empty profile', () => {
    for (const scope of ['user', 'project', 'both'] as const) {
      const resolved = resolveAgent(project, scope, 'poteto-agent');
      expect(resolved.agent).toMatchObject({ name: 'poteto-agent', source: 'package' });
      expect(resolved.agent?.systemPrompt).toContain('Poteto subagent');
    }
  });

  test('a user agent of the same name overrides the bundled one', () => {
    write(path.join(userHome, 'agents', 'poteto-agent.md'), agentMd('poteto-agent'));
    expect(resolveAgent(project, 'user', 'poteto-agent').agent?.source).toBe('user');
  });
});
