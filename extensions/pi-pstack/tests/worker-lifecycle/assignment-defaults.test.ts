// Optional assignment fields get their defaults, and spawn writes the completed assignment back before the claim.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ENGINEERING_CAPABILITIES, loadAssignment, parseAssignment } from '../../src/run-files.ts';
import { makeParent, makeProject, makeRun, type Parent, type Project, readState, stopProject, until, workerDir } from './harness.ts';

let project: Project;

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'run1');
});

afterEach(async () => {
  await stopProject(project);
});

function writeRaw(workerId: string, assignment: Record<string, unknown>, brief = '@@say MINIMAL'): string {
  const dir = workerDir(project, 'run1', workerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), brief);
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify(assignment));
  return join(dir, 'assignment.json');
}

const minimal = (workerId: string) => ({ runId: 'run1', workerId, role: 'general', model: 'scripted/echo', workspace: { mode: 'readonly' }, brief: 'brief.md' });

describe('hand-written assignments', () => {
  let parent: Parent;
  beforeEach(() => {
    parent = makeParent(project, []);
  });
  afterEach(async () => {
    await parent.stop();
  });

  test('a minimal assignment spawns, and the stored file is complete and still validates', async () => {
    const path = writeRaw('min', minimal('min'));
    await parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: path });
    const collected = await until(
      async () => (await parent.call('pstack_worker', { action: 'collect', runId: 'run1', workerId: 'min' })).details,
      (details) => details.settled === true,
      20_000,
      'min settles',
    );
    expect(collected.finalText).toBe('MINIMAL');
    const complete = {
      schemaVersion: 1,
      runId: 'run1',
      workerId: 'min',
      kind: 'pi',
      role: 'general',
      brief: 'brief.md',
      model: 'scripted/echo',
      thinkingLevel: null,
      workspace: { mode: 'readonly', path: project.dir },
      skills: [],
      capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false },
    };
    const bytes = readFileSync(path);
    expect(JSON.parse(bytes.toString('utf8'))).toStrictEqual(complete);
    expect(loadAssignment(path).assignment).toStrictEqual(complete);
    expect(readState(project, 'run1', 'min').digest).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  test('a claimed assignment is never rewritten', async () => {
    const path = writeRaw('taken', minimal('taken'));
    mkdirSync(join(workerDir(project, 'run1', 'taken'), 'claim'));
    const before = readFileSync(path, 'utf8');
    await expect(parent.call('pstack_worker', { action: 'spawn', runId: 'run1', assignmentPath: path })).rejects.toThrow(/already claimed/);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

test('a watch defaults its cwd, and a readonly workspace its path, to the project root', () => {
  const path = writeRaw('tick', { runId: 'run1', workerId: 'tick', role: 'watcher', model: 'inherit-parent', kind: 'watch', workspace: { mode: 'readonly' }, watch: { argv: ['true'] } });
  expect(loadAssignment(path).assignment).toMatchObject({ kind: 'watch', workspace: { mode: 'readonly', path: project.dir }, watch: { argv: ['true'], cwd: project.dir } });
});

describe('a container worker', () => {
  const container = (capabilities?: Record<string, unknown>) => ({ ...minimal('c'), workspace: { mode: 'container', inputCommit: 'abc1234' }, ...(capabilities === undefined ? {} : { capabilities }) });
  const defaults = { capabilities: ENGINEERING_CAPABILITIES, projectRoot: '/p' };

  test('defaults to a minimal environment, and keeps every other default of its run', () => {
    expect(parseAssignment(container(), defaults).capabilities).toEqual({ mcp: 'inherit', env: 'minimal', externalWrite: false });
  });

  test('gets the whole environment only when the assignment names inherit', () => {
    expect(parseAssignment(container({ mcp: 'inherit', env: 'inherit', externalWrite: false }), defaults).capabilities.env).toBe('inherit');
  });

  test('takes the forge capability only on a container workspace, as a boolean', () => {
    const forge = { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true };
    expect(parseAssignment(container(forge), defaults).capabilities).toEqual(forge);
    expect(() => parseAssignment({ ...container(forge), workspace: { mode: 'worktree', inputCommit: 'abc1234' } }, defaults)).toThrow(/forge needs a container workspace/);
    expect(() => parseAssignment({ ...container(forge), workspace: { mode: 'readonly' } }, defaults)).toThrow(/forge needs a container workspace/);
    expect(() => parseAssignment(container({ ...forge, forge: 'yes' }), defaults)).toThrow(/capabilities must be/);
    expect(() => parseAssignment(container({ ...forge, push: true }), defaults)).toThrow(/capabilities must be/);
  });

  test('a worktree worker keeps the inherit default', () => {
    expect(parseAssignment({ ...container(), workspace: { mode: 'worktree', inputCommit: 'abc1234' } }, defaults).capabilities.env).toBe('inherit');
  });
});

test('a worker of an automation run defaults to the automation capabilities', () => {
  makeRun(project, 'auto1', null);
  const dir = join(project.runRoot('auto1'), 'workers', 'w');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ ...minimal('w'), runId: 'auto1' }));
  expect(loadAssignment(join(dir, 'assignment.json')).assignment.capabilities).toEqual({ mcp: 'none', env: 'minimal', externalWrite: false });
});

describe('the worker-assignment reference', () => {
  const reference = readFileSync(join(import.meta.dirname, '../../generated/skills/poteto-mode/references/worker-assignment.md'), 'utf8');
  const examples = [...reference.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1] ?? '') as Record<string, unknown> & { workspace: Record<string, unknown> });
  const root = '/Users/you/src/app';
  const defaults = { capabilities: ENGINEERING_CAPABILITIES, projectRoot: root };
  test('holds an example per workspace mode and kind', () => {
    expect(examples.map((example) => `${example['kind']}/${example.workspace['mode']}`).sort()).toEqual(['pi/container', 'pi/readonly', 'pi/worktree', 'watch/readonly', 'watch/readonly']);
  });

  test.for(examples.map((example) => [example['workerId'], example] as const))('%s parses unchanged, with the role default capabilities added', ([, example]) => {
    const containerDefault = { ...ENGINEERING_CAPABILITIES, env: 'minimal' };
    expect(parseAssignment(example, defaults)).toStrictEqual({ ...example, capabilities: example.workspace['mode'] === 'container' ? containerDefault : ENGINEERING_CAPABILITIES });
  });

  test.for(examples.map((example) => [example['workerId'], example] as const))('%s with every defaulted field left out parses to the same assignment', ([, example]) => {
    const { schemaVersion: _version, kind, skills, thinkingLevel, ...rest } = example;
    const stripped: Record<string, unknown> = { ...rest, workspace: example.workspace['path'] === root ? { mode: 'readonly' } : example.workspace };
    if (kind !== 'pi') stripped['kind'] = kind;
    if ((skills as string[]).length > 0) stripped['skills'] = skills;
    if (thinkingLevel !== null) stripped['thinkingLevel'] = thinkingLevel;
    const watch = example['watch'] as { argv: string[]; cwd: string } | undefined;
    if (watch !== undefined) stripped['watch'] = { argv: watch.argv };
    expect(parseAssignment(stripped, defaults)).toStrictEqual(parseAssignment(example, defaults));
  });
});

describe('the model spec', () => {
  const defaults = { capabilities: ENGINEERING_CAPABILITIES, projectRoot: '/p' };
  const parse = (model: unknown) => parseAssignment({ ...minimal('m'), model }, defaults).model;

  test.for(['inherit-parent', 'zai/glm-5.3-flash', 'claude-opus-5-5-xhigh', 'grok-4.7-xhigh-fast', 'claude-sonnet-5-5-high'])('accepts %s', (model) => {
    expect(parse(model)).toBe(model);
  });

  test.for(['grok-4.7', 'grok-4.7-turbo', 'xhigh', 'Claude-xhigh', 'grok-4.7-xhigh-slow', 'a b/c', 42])('rejects %s and lists the accepted forms', (model) => {
    expect(() => parse(model)).toThrow(/Assignment model must be 'inherit-parent', '<provider>\/<id>', or a family default '<model>-<level>\[-fast\]' such as 'claude-opus-5-5-xhigh' or 'grok-4\.7-xhigh-fast'/);
  });

  test('a rejection quotes the spec that failed', () => {
    expect(() => parse('grok-4.7')).toThrow("got 'grok-4.7'");
  });
});
