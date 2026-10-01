import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { modelConfigPath, readModelRule, resolveModel, roleNames } from '../src/models.ts';
import { fixture, packageRoot, prompt, section } from './session-fixture.ts';

async function hostContract(prepare?: (cwd: string, agentDir: string) => Promise<void>) {
  const f = await fixture({ extensionOnly: true });
  try {
    await prepare?.(f.cwd, join(f.root, 'agent'));
    const { session } = await f.open();
    await prompt(session, 'Record the host contract');
    return { host: section(f.requests, 'pstack_host') ?? '', agentDir: join(f.root, 'agent'), cwd: f.cwd };
  } finally {
    await f.close();
  }
}

test('host contract names the agent store, its orchestrate and docs directories, and the ORCH_STORE export', async () => {
  const { host, agentDir } = await hostContract();
  const store = host.match(/^Agent store: (\S+)\.$/m)?.[1] ?? '';
  expect(store).toMatch(new RegExp(`^${agentDir}/pstack/store/workspace-[0-9a-f]{8}$`));
  expect(host).toContain(`orchestrate/<project-slug>/ under ${store}`);
  expect(host).toContain(`plans default to ${store}/docs/`);
  expect(host).toContain(`export ORCH_STORE=${store}/orchestrate/<project-slug> before the first orch call`);
});

test('host contract maps WebSearch and WebFetch to bash with curl when no search tool is registered', async () => {
  const { host } = await hostContract();
  expect(host).toContain('Cursor WebSearch and WebFetch have no built-in Pi tool.');
  expect(host).toContain("curl -sL --max-time 20 -A 'Mozilla/5.0' 'https://www.bing.com/search?q=<url-encoded query>'");
  expect(host).toContain('Prefer a web search tool that another extension registers in the active tool list.');
});

test('host contract requires typescript-best-practices before editing a .ts or .tsx file', async () => {
  const { host } = await hostContract();
  expect(host).toContain(`Before you edit or create any .ts or .tsx file, read ${join(packageRoot, 'skills/typescript-best-practices/SKILL.md')} in full once per session.`);
});

test('host contract maps the image-generation tool to an SVG fallback with a stated substitution', async () => {
  const { host } = await hostContract();
  expect(host).toContain('Cursor image generation has no built-in Pi tool.');
  expect(host).toContain('write a self-contained SVG file in marker-on-whiteboard style with few short labels');
  expect(host).toContain('say that the picture is a substitute');
});

test('host contract names the model role of each reviewer, judge, and miner spawn', async () => {
  const { host } = await hostContract();
  expect(host).toContain('Role lines: "trail reviewer" is the show-me-your-work cross-model reviewer, "figure-it-out judge" is the figure-it-out judge, and "recall miners" are the recall fan-out subagents.');
  expect(host).toContain('The trail reviewer and the judge must run on a different model family from the work they review.');
});

test('host contract runs every role with no configured line on the parent model', async () => {
  const { host } = await hostContract();
  expect(host).toContain('No override. Every role without a line runs on the parent model (inherit-parent). Omit Task model for it, because a skill default slug is a Cursor catalog name and not a Pi model id.');
});

test('host contract names the origin CLI detection that includes the off-PATH install', async () => {
  const { host } = await hostContract();
  expect(host).toContain('The origin CLI is present when `command -v origin || test -x ~/.local/bin/origin` succeeds.');
});

test('host contract maps the Cursor dashboard status of a cloud agent to TaskList and TaskAttach', async () => {
  const { host } = await hostContract();
  expect(host).toContain('Cursor dashboard cloud-agent status maps to TaskList({ repository: true }) and TaskAttach, which read status without a prompt.');
});

test('every role without a configured line resolves to the parent model on a fresh install', () => {
  const parent = { provider: 'p', id: 'parent-model', reasoning: false } as never;
  const ctx = { model: parent, thinkingLevel: 'off', modelRegistry: { getAvailable: () => [] } } as never;
  expect(roleNames).toContain('trail reviewer');
  expect(roleNames).toContain('figure-it-out judge');
  expect(roleNames).toContain('recall miners');
  for (const role of roleNames) expect(resolveModel(undefined, ctx), role).toEqual({ model: parent, thinkingLevel: 'off' });
});

test('a project model rule overrides the user rule per role and leaves other roles alone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-project-rule-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', join(directory, 'agent'));
  try {
    const workspace = join(directory, 'workspace');
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), 'bug-fix: user/bug\nhillclimb: user/climb\n');
    expect(await readModelRule(workspace)).toBe('bug-fix: user/bug\nhillclimb: user/climb\n');
    await mkdir(join(workspace, '.pi/pstack'), { recursive: true });
    await writeFile(join(workspace, '.pi/pstack/models.mdc'), '---\nalwaysApply: true\n---\nbug-fix: project/bug\nswarm workers: project/swarm\n');
    const merged = await readModelRule(workspace);
    expect(merged).toContain('hillclimb: user/climb');
    expect(merged).toContain('bug-fix: project/bug');
    expect(merged).toContain('swarm workers: project/swarm');
    expect(merged).not.toContain('user/bug');
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the host contract carries the project model rule and names its path', async () => {
  const { host, cwd } = await hostContract(async (workspace, agentDir) => {
    await mkdir(join(agentDir, 'pstack'), { recursive: true });
    await writeFile(join(agentDir, 'pstack/models.mdc'), 'bug-fix: user/bug\n');
    await mkdir(join(workspace, '.pi/pstack'), { recursive: true });
    await writeFile(join(workspace, '.pi/pstack/models.mdc'), 'bug-fix: project/bug\n');
  });
  expect(host).toContain(`A project rule at ${join(cwd, '.pi/pstack/models.mdc')} overrides the user rule for the roles it names when the file exists.`);
  expect(host).toContain('bug-fix: project/bug');
  expect(host).not.toContain('user/bug');
});
