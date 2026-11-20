import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { assistantLine, byTask, CHILD_WAIT_MS, dies, says, startedChildren } from './subagent-child-output.ts';
import { type FakeChild, fakePi } from './subagent-fake-pi.ts';
import { loadSubagent, makeCtx, SUBAGENT_BANNER, settledFrom, textOf, useWorkspace, writeAgent } from './subagent-host.ts';

const workspace = useWorkspace();
const ONE_TURN_USAGE = '<usage>turns=1 input=1 output=1 cache_read=0 cache_write=0 cost=1.0000</usage>';
const TWO_TURN_USAGE = '<usage>turns=2 input=2 output=2 cache_read=0 cache_write=0 cost=2.0000</usage>';
const TWO_TURNS = 2;
const LONG_ANSWER_LINES = 3000;
const DEPTH = 'PI_SUBAGENT_DEPTH';
const MAX_DEPTH = 'PI_SUBAGENT_MAX_DEPTH';
const MAX_CONCURRENT = 'PI_SUBAGENT_MAX_CONCURRENT';
const WAKE = { agent: 'scout', task: 'look', wake: 'scout finished' };

const ctx = (mode = 'print') => makeCtx(workspace().project, { mode });
const single = (params: Record<string, unknown> = {}) => loadSubagent().call({ agent: 'scout', task: 'look', ...params }, ctx());
const tasksFor = (...tasks: string[]) => tasks.map((task) => ({ agent: 'scout', task }));
const countOf = (text: string, part: string): number => text.split(part).length - 1;
const onlyChild = (): FakeChild | undefined => fakePi.children()[0];
const finish = (child: FakeChild | undefined, text = 'finished'): void => {
  child?.stdout(`${assistantLine(text)}\n`);
  child?.exit(0);
};

describe('subagent reports are framed as untrusted model output', () => {
  test('a single call opens with the banner and closes with its usage', async () => {
    expect(textOf(await single())).toBe(`${SUBAGENT_BANNER}\n\ndone\n\n${ONE_TURN_USAGE}`);
  });

  test('a failed single call is framed too, with no usage when no turn ran', async () => {
    fakePi.onChild(dies(1, 'boom'));
    const text = textOf(await single());
    expect(text.startsWith(`${SUBAGENT_BANNER}\n\nAgent failed:`)).toBe(true);
    expect(text).not.toContain('<usage>');
  });

  test('a parallel call is framed once, with the usage of every task added up', async () => {
    const text = textOf(await loadSubagent().call({ tasks: tasksFor('a', 'b') }, ctx()));
    expect(text.startsWith(`${SUBAGENT_BANNER}\n\nParallel: 2/2 succeeded`)).toBe(true);
    expect(countOf(text, SUBAGENT_BANNER)).toBe(1);
    expect(text.endsWith(`\n\n${TWO_TURN_USAGE}`)).toBe(true);
  });

  test('a chain is framed once, with the usage of every step added up', async () => {
    fakePi.onChild(byTask({ first: says('one'), 'use one': says('two') }));
    const text = textOf(await loadSubagent().call({ chain: [{ agent: 'scout', task: 'first' }, { agent: 'scout', task: 'use {previous}' }] }, ctx()));
    expect(text).toBe(`${SUBAGENT_BANNER}\n\ntwo\n\n${TWO_TURN_USAGE}`);
  });

  test('a stopped chain is framed', async () => {
    fakePi.onChild(dies(1, 'bad'));
    const text = textOf(await loadSubagent().call({ chain: tasksFor('first', 'second') }, ctx()));
    expect(text.startsWith(`${SUBAGENT_BANNER}\n\nChain stopped at step 1`)).toBe(true);
  });

  test('the banner is never cut away by a long answer', async () => {
    fakePi.onChild(says('line\n'.repeat(LONG_ANSWER_LINES)));
    expect(textOf(await single()).startsWith(`${SUBAGENT_BANNER}\n\n`)).toBe(true);
  });
});

describe('wake reports are framed once as untrusted model output', () => {
  test('a wake report carries the banner once, not twice', async () => {
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    const content = subagent.sent()[0]?.message.content ?? '';
    expect(countOf(content, SUBAGENT_BANNER)).toBe(1);
    expect(content).toContain(`finished.\n\n${SUBAGENT_BANNER}\n\ndone\n\n`);
    expect(content).toMatch(new RegExp(`${ONE_TURN_USAGE}\\n\\nOutput file: \\S+\\.output$`));
  });

  test('a wake job that crashed is framed too', async () => {
    fakePi.onChild((child) => {
      child.stdout(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [] } }));
      child.exit(0);
    });
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(subagent.sent()[0]?.message.content).toContain(`${SUBAGENT_BANNER}\n\nFailed: `);
  });

  test('a print-mode wake report is framed once as well', async () => {
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('print'));
    const settled = settledFrom(await subagent.fire('agent_before_settle', { entries: [] }, ctx('print')));
    expect(countOf(settled?.entries[0]?.content ?? '', SUBAGENT_BANNER)).toBe(1);
  });
});

describe('subagent nesting depth', () => {
  test('a top-level call starts its child one level down', async () => {
    await single();
    expect(onlyChild()?.env[DEPTH]).toBe('1');
  });

  test('a child of a child is started one level further down', async () => {
    vi.stubEnv(DEPTH, '2');
    await single();
    expect(onlyChild()?.env[DEPTH]).toBe('3');
  });

  test.for(['abc', '-1', '1.5', ''])('reads a depth of %j as the top level', async (value) => {
    vi.stubEnv(DEPTH, value);
    await single();
    expect(onlyChild()?.env[DEPTH]).toBe('1');
  });

  test('refuses to start a child once the depth reaches the default limit of 3', async () => {
    vi.stubEnv(DEPTH, '3');
    const result = await single();
    expect(result.details?.isError).toBe(true);
    expect(textOf(result)).toMatch(/nesting depth limit/i);
    expect(fakePi.children()).toHaveLength(0);
  });

  test('starts a child one level under the default limit', async () => {
    vi.stubEnv(DEPTH, '2');
    expect((await single()).details?.isError).toBe(false);
  });
});

describe('subagent nesting depth overrides and modes', () => {
  test.for([
    ['single', { agent: 'scout', task: 'go' }],
    ['parallel', { tasks: tasksFor('a') }],
    ['chain', { chain: tasksFor('a') }],
  ] as const)('refuses a %s call at the limit without starting any child', async ([mode, params]) => {
    vi.stubEnv(MAX_DEPTH, '1');
    vi.stubEnv(DEPTH, '1');
    const result = await loadSubagent().call(params, ctx());
    expect(result.details?.isError).toBe(true);
    expect(result.details?.mode).toBe(mode);
    expect(fakePi.children()).toHaveLength(0);
  });

  test('a limit of 0 forbids every subagent', async () => {
    vi.stubEnv(MAX_DEPTH, '0');
    expect((await single()).details?.isError).toBe(true);
    expect(fakePi.children()).toHaveLength(0);
  });

  test('a raised limit lets deeper calls through', async () => {
    vi.stubEnv(MAX_DEPTH, '10');
    vi.stubEnv(DEPTH, '5');
    await single();
    expect(onlyChild()?.env[DEPTH]).toBe('6');
  });

  test('refuses a wake job at the limit and says so in its report', async () => {
    vi.stubEnv(MAX_DEPTH, '1');
    vi.stubEnv(DEPTH, '1');
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    expect(subagent.sent()[0]?.message.content).toMatch(/nesting depth limit/i);
    expect(fakePi.children()).toHaveLength(0);
  });
});

describe('the cap on workers running at once', () => {
  test('refuses a call that needs more workers than the cap allows, starting none', async () => {
    vi.stubEnv(MAX_CONCURRENT, '1');
    const result = await loadSubagent().call({ tasks: tasksFor('a', 'b') }, ctx());
    expect(result.details?.isError).toBe(true);
    expect(textOf(result)).toMatch(/concurrency cap/i);
    expect(fakePi.children()).toHaveLength(0);
  });

  test('lets a call use exactly the cap', async () => {
    vi.stubEnv(MAX_CONCURRENT, '2');
    const result = await loadSubagent().call({ tasks: tasksFor('a', 'b') }, ctx());
    expect(result.details?.isError).toBe(false);
    expect(fakePi.children()).toHaveLength(TWO_TURNS);
  });

  test('frees the slots when a call finishes', async () => {
    vi.stubEnv(MAX_CONCURRENT, '1');
    const subagent = loadSubagent();
    expect((await subagent.call({ agent: 'scout', task: 'one' }, ctx())).details?.isError).toBe(false);
    expect((await subagent.call({ agent: 'scout', task: 'two' }, ctx())).details?.isError).toBe(false);
  });

  test('frees the slots when a worker fails', async () => {
    vi.stubEnv(MAX_CONCURRENT, '1');
    fakePi.onChild(dies(1, 'boom'));
    const subagent = loadSubagent();
    await subagent.call({ agent: 'scout', task: 'one' }, ctx());
    fakePi.onChild(says('fine'));
    expect((await subagent.call({ agent: 'scout', task: 'two' }, ctx())).details?.isError).toBe(false);
  });
});

describe('concurrent and woken jobs share the worker cap', () => {
  test('a running call keeps its slots, so a second call at the cap is refused', async () => {
    vi.stubEnv(MAX_CONCURRENT, '1');
    fakePi.onChild(() => undefined);
    const subagent = loadSubagent();
    const first = subagent.call({ agent: 'scout', task: 'one' }, ctx());
    const [child] = await startedChildren(1);
    const second = await subagent.call({ agent: 'scout', task: 'two' }, ctx());
    expect(second.details?.isError).toBe(true);
    expect(textOf(second)).toMatch(/concurrency cap/i);
    finish(child);
    expect((await first).details?.isError).toBe(false);
  });

  test('a woken job counts against the cap until it reports, and frees its slot after', async () => {
    vi.stubEnv(MAX_CONCURRENT, '1');
    fakePi.onChild(() => undefined);
    const subagent = loadSubagent();
    await subagent.call(WAKE, ctx('tui'));
    const [child] = await startedChildren(1);
    const refused = await subagent.call({ agent: 'scout', task: 'second' }, ctx('tui'));
    expect(refused.details?.isError).toBe(true);
    expect(fakePi.children()).toHaveLength(1);
    finish(child);
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    fakePi.onChild(says('done'));
    expect((await subagent.call({ agent: 'scout', task: 'third' }, ctx('tui'))).details?.isError).toBe(false);
  });

  test('a stopped wake job frees its slot', async () => {
    vi.stubEnv(MAX_CONCURRENT, '1');
    fakePi.onChild(() => undefined);
    const subagent = loadSubagent();
    const started = textOf(await subagent.call(WAKE, ctx('tui')));
    await startedChildren(1);
    await subagent.call({ stop: /subagent job (\S+?)\./.exec(started)?.[1] }, ctx('tui'));
    await vi.waitFor(() => expect(subagent.sent()).toHaveLength(1), CHILD_WAIT_MS);
    fakePi.onChild(says('done'));
    expect((await subagent.call({ agent: 'scout', task: 'after' }, ctx('tui'))).details?.isError).toBe(false);
  });

  test.for(['0', '-3', 'many'])('reads a cap of %j as the default of 20', async (value) => {
    vi.stubEnv(MAX_CONCURRENT, value);
    expect((await single()).details?.isError).toBe(false);
  });
});

describe('agent frontmatter, tools', () => {
  const run = async (frontmatter: string): Promise<FakeChild | undefined> => {
    writeAgent(workspace().userAgents, 'custom', frontmatter);
    await single({ agent: 'custom' });
    return onlyChild();
  };

  test('disallowedTools alone removes those tools from every built-in tool', async () => {
    const child = await run('disallowedTools: bash, write\n');
    expect(child?.flag('--tools')).toBe('read,edit,grep,find,ls');
  });

  test('disallowedTools removes tools from the list the agent names, ignoring case', async () => {
    const child = await run('tools: read, bash, edit\ndisallowedTools: [BASH]\n');
    expect(child?.flag('--tools')).toBe('read,edit');
  });

  test('starts the child with no tools when every tool is disallowed', async () => {
    const child = await run('tools: read, bash\ndisallowedTools: read, bash\n');
    expect(child?.args).toContain('--no-tools');
    expect(child?.args).not.toContain('--tools');
  });

  test('a * in disallowedTools bans nothing', async () => {
    const child = await run('disallowedTools: "*"\n');
    expect(child?.args).not.toContain('--tools');
    expect(child?.args).not.toContain('--no-tools');
  });

  test('an agent that names no tools and bans none keeps the default tools', async () => {
    const child = await run('');
    expect(child?.args).not.toContain('--tools');
    expect(child?.args).not.toContain('--no-tools');
  });
});

describe('agent frontmatter, context files', () => {
  test.for([
    ['omitContextFiles: true\n', true],
    ['omitClaudeMd: true\n', true],
    ['omitContextFiles: false\n', false],
    ['omitContextFiles: "yes"\n', false],
    ['', false],
  ] as const)('with %j the child %s', async ([frontmatter, omits]) => {
    writeAgent(workspace().userAgents, 'custom', frontmatter);
    await single({ agent: 'custom' });
    expect(onlyChild()?.args.includes('--no-context-files')).toBe(omits);
  });
});

const SKILL = 'tier1-demo-skill';
const writeSkill = (root: string, name: string, body: string): void => {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: demo\n---\n${body}\n`);
};
const promptOf = async (frontmatter: string): Promise<string> => {
  writeAgent(workspace().userAgents, 'custom', frontmatter, 'You are custom.');
  let prompt = '';
  fakePi.onChild((child) => {
    prompt = fs.readFileSync(child.flag('--append-system-prompt') ?? '', 'utf8');
    says('ok')(child);
  });
  await single({ agent: 'custom' });
  return prompt;
};

describe('agent frontmatter, preloaded skills', () => {
  test('adds a project skill body, without its frontmatter, after the agent prompt', async () => {
    writeSkill(path.join(workspace().project, '.pi', 'skills'), SKILL, 'Skill body text.');
    const prompt = await promptOf(`skills: ${SKILL}\n`);
    expect(prompt.trim()).toBe(`You are custom.\n\nLoaded agent skill: ${SKILL}\n\nSkill body text.`);
  });

  test.for(['.agents/skills', 'agent/skills'])('finds a skill under %s', async (dir) => {
    const root = dir.startsWith('agent') ? path.join(workspace().root, dir) : path.join(workspace().project, dir);
    writeSkill(root, SKILL, 'Found here.');
    expect(await promptOf(`skills: [${SKILL}]\n`)).toContain(`Loaded agent skill: ${SKILL}\n\nFound here.`);
  });

  test('the project .pi skill wins over the same skill elsewhere', async () => {
    writeSkill(path.join(workspace().project, '.pi', 'skills'), SKILL, 'From pi.');
    writeSkill(path.join(workspace().project, '.agents', 'skills'), SKILL, 'From agents.');
    const prompt = await promptOf(`skills: ${SKILL}\n`);
    expect(prompt).toContain('From pi.');
    expect(prompt).not.toContain('From agents.');
  });
});

describe('agent frontmatter, preloaded skill edge cases', () => {
  test('loads a skill named twice once and skips a skill that does not exist', async () => {
    writeSkill(path.join(workspace().project, '.pi', 'skills'), SKILL, 'Once.');
    const prompt = await promptOf(`skills: ${SKILL}, no-such-skill-anywhere, ${SKILL}\n`);
    expect(prompt.match(/Loaded agent skill:/g)).toHaveLength(1);
    expect(prompt).not.toContain('no-such-skill-anywhere');
  });

  test('a skill name that climbs out of a skills directory loads nothing', async () => {
    fs.mkdirSync(path.join(workspace().project, 'secret'), { recursive: true });
    fs.writeFileSync(path.join(workspace().project, 'secret', 'SKILL.md'), 'top secret');
    const prompt = await promptOf('skills: "../../secret"\n');
    expect(prompt).not.toContain('top secret');
    expect(prompt.trim()).toBe('You are custom.');
  });

  test('gives a skill to an agent that has no prompt of its own', async () => {
    writeSkill(path.join(workspace().project, '.pi', 'skills'), SKILL, 'Alone.');
    writeAgent(workspace().userAgents, 'bare', `skills: ${SKILL}\n`, '');
    let prompt = '';
    fakePi.onChild((child) => {
      prompt = fs.readFileSync(child.flag('--append-system-prompt') ?? '', 'utf8');
      says('ok')(child);
    });
    await single({ agent: 'bare' });
    expect(prompt).toBe(`Loaded agent skill: ${SKILL}\n\nAlone.`);
  });

  test('home skills are searched last', async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-')));
    vi.stubEnv('HOME', home);
    writeSkill(path.join(home, '.agents', 'skills'), SKILL, 'From home.');
    try {
      expect(await promptOf(`skills: ${SKILL}\n`)).toContain('From home.');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('agent frontmatter, turn limit', () => {
  const turn = (child: FakeChild, label: string, stopReason = 'toolUse'): void => child.stdout(`${assistantLine(label, { stopReason })}\n`);
  const writeLimited = (maxTurns: string): void => {
    writeAgent(workspace().userAgents, 'limited', `maxTurns: ${maxTurns}\n`);
  };

  test('stops a worker that reaches its turn limit and reports it completed', async () => {
    writeLimited('2');
    fakePi.onChild((child) => {
      turn(child, 'turn one');
      turn(child, 'turn two');
    });
    const result = await single({ agent: 'limited' });
    expect(result.details?.results[0]).toMatchObject({ status: 'completed', stopReason: 'max_turns', errorMessage: undefined });
    expect(result.details?.isError).toBe(false);
    expect(textOf(result)).toBe(`${SUBAGENT_BANNER}\n\nturn two\n\n${TWO_TURN_USAGE}`);
    await vi.waitFor(() => expect(onlyChild()?.state).toBe('gone'), CHILD_WAIT_MS);
  });

  test('lets a worker that finishes within its limit end normally', async () => {
    writeLimited('3');
    fakePi.onChild((child) => {
      turn(child, 'working');
      turn(child, 'all done', 'stop');
      child.exit(0);
    });
    const result = await single({ agent: 'limited' });
    expect(result.details?.results[0]).toMatchObject({ status: 'completed', stopReason: 'stop' });
  });

  test('a worker whose last allowed turn is its final answer is not cut short', async () => {
    writeLimited('1');
    fakePi.onChild((child) => {
      turn(child, 'the answer', 'stop');
      child.exit(0);
    });
    expect((await single({ agent: 'limited' })).details?.results[0]).toMatchObject({ stopReason: 'stop' });
  });

  test.for(['0', '-2', '1.5', 'many'])('ignores a maxTurns of %j', async (value) => {
    writeLimited(value);
    fakePi.onChild((child) => {
      for (const label of ['a', 'b', 'c', 'd']) turn(child, label);
      child.exit(0);
    });
    const result = await single({ agent: 'limited' });
    expect(result.details?.results[0]).toMatchObject({ status: 'completed', stopReason: 'toolUse' });
  });

  test('a caller abort before the limit still ends the call aborted', async () => {
    writeLimited('5');
    fakePi.onChild((child) => turn(child, 'one'));
    const controller = new AbortController();
    const running = loadSubagent().call({ agent: 'limited', task: 'go' }, ctx(), controller.signal);
    await startedChildren(1);
    controller.abort();
    expect((await running).details?.results[0]).toMatchObject({ status: 'aborted' });
  });
});
