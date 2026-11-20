import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createWorld, type Host, loadPstack, promptFor, type World } from './core-host.ts';

const MODE_KEY = 'pstack-mode';
const MODE_OFF_COMMAND = '/pstack-mode off';
const SESSION_FILE = '/sessions/run.jsonl';
const SKILL_PATH_PLACEHOLDER = '/<name>/SKILL.md';
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
});

afterEach(() => {
  world.dispose();
});

const mode = async (args: string, overrides: Record<string, unknown> = {}) => host.command(MODE_KEY).handler(args, host.ctx(overrides));
const modeSection = async () => (await promptFor(host)).sections[MODE_KEY];

describe('the pstack-mode command keeps a skill in the system prompt', () => {
  test('the skill rides in the prompt on every turn until the mode is turned off', async () => {
    expect(await modeSection()).toBeUndefined();
    await mode('poteto-mode');
    const section = await modeSection();
    expect(section).toContain('<skill name="poteto-mode"');
    expect(section).toContain('# Poteto mode');
    expect(section).toContain(MODE_OFF_COMMAND);
    expect(await modeSection()).toBe(section);
    expect(host.setStatus).toHaveBeenLastCalledWith(MODE_KEY, 'mode: poteto-mode');
    await mode('off');
    expect(await modeSection()).toBeUndefined();
    expect(host.setStatus).toHaveBeenLastCalledWith(MODE_KEY, undefined);
  });

  test('the skill text says where its relative references resolve, without its frontmatter', async () => {
    await mode('  poteto-mode  ');
    const section = (await modeSection()) ?? '';
    expect(section).toContain(`References are relative to ${join(PACKAGE_ROOT, 'skills', 'poteto-mode')}.`);
    expect(section).not.toContain('disable-model-invocation');
  });

  test('the mode is recorded on the session branch', async () => {
    await mode('poteto-mode');
    await mode('off');
    expect(host.branch()).toEqual([
      { type: 'custom', customType: MODE_KEY, data: { skill: 'poteto-mode' } },
      { type: 'custom', customType: MODE_KEY, data: { skill: undefined } },
    ]);
  });

  test('a name that is not a pstack skill is refused and the current mode stays', async () => {
    await mode('poteto-mode');
    await mode('../../etc');
    expect(await modeSection()).toContain('<skill name="poteto-mode"');
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('../../etc is not a pstack skill'), 'error');
  });
});

describe('the pstack-mode command with no argument, no UI, and a restored session', () => {
  test('an empty argument says whether a mode is on', async () => {
    await mode('   ');
    expect(host.notify).toHaveBeenLastCalledWith('No pstack mode is on. /pstack-mode <skill> starts one.', 'info');
    await mode('poteto-mode');
    await mode('');
    expect(host.notify).toHaveBeenLastCalledWith('poteto-mode mode is on. /pstack-mode off ends it.', 'info');
  });

  test('without a UI the command still switches the mode and shows nothing', async () => {
    await mode('poteto-mode', { hasUI: false });
    await mode('', { hasUI: false });
    await mode('nonesuch', { hasUI: false });
    expect(await modeSection()).toContain('<skill name="poteto-mode"');
    expect(host.notify).not.toHaveBeenCalled();
    expect(host.setStatus).not.toHaveBeenCalled();
  });

  test('completions offer off and every skill that starts with what was typed', () => {
    const complete = host.command(MODE_KEY).getArgumentCompletions;
    expect(complete?.('o')).toEqual([{ value: 'off', label: 'off' }]);
    expect(complete?.('poteto-m')).toEqual([{ value: 'poteto-mode', label: 'poteto-mode' }]);
    expect(complete?.('')?.map((item) => item.value)).toEqual(expect.arrayContaining(['off', 'poteto-mode', 'arena']));
    expect(complete?.('zzz')).toBeNull();
  });

  test.for<[string, string]>([
    ['starts', 'session_start'],
    ['moves to another branch', 'session_tree'],
  ])('the mode comes back from the session branch when the session %s', async ([, event]) => {
    host.setBranch([{ type: 'custom', customType: MODE_KEY, data: { skill: 'arena' } }]);
    await host.fire(event, {});
    expect(await modeSection()).toContain('<skill name="arena"');
    expect(host.setStatus).toHaveBeenLastCalledWith(MODE_KEY, 'mode: arena');
    host.setBranch([]);
    await host.fire('session_tree', {});
    expect(await modeSection()).toBeUndefined();
  });

  test('a recorded mode that names no pstack skill, or an unrelated entry, restores no mode', async () => {
    host.setBranch([{ type: 'custom', customType: MODE_KEY, data: { skill: 'arena' } }, { type: 'custom', customType: MODE_KEY, data: { skill: 'deleted-skill' } }, { type: 'message' }]);
    await host.fire('session_start', {});
    expect(await modeSection()).toBeUndefined();
    host.setBranch([{ type: 'custom', customType: MODE_KEY }]);
    await host.fire('session_tree', {});
    expect(await modeSection()).toBeUndefined();
  });
});

describe('the system prompt additions', () => {
  test('say where every pstack skill lives, once, since Pi hides some from the skill list', async () => {
    const options = await promptFor(host);
    await host.fire('before_agent_start', { systemPromptOptions: options });
    const hints = options.promptGuidelines.filter((rule) => rule.includes(SKILL_PATH_PLACEHOLDER));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain(join(PACKAGE_ROOT, 'skills'));
    expect(hints[0]).toMatch(/read that file and follow it/);
  });

  test('carry the model roles when /skill:setup-pstack wrote them', async () => {
    expect((await promptFor(host)).sections['pstack-models']).toBeUndefined();
    writeFileSync(join(world.agentDir, 'pstack-v2-models.md'), '\nswarm workers: prov/model high\n\n');
    const models = (await promptFor(host)).sections['pstack-models'];
    expect(models).toBe(`Role lines from ${join(world.agentDir, 'pstack-v2-models.md')}, written by /skill:setup-pstack:\nswarm workers: prov/model high`);
  });

  test("name this session's transcript, since a worker cannot find the parent session by itself", async () => {
    const persisted = loadPstack(world, { sessionFile: SESSION_FILE });
    expect((await promptFor(persisted)).sections['pstack-session']).toContain(`transcript is ${SESSION_FILE}.`);
    expect((await promptFor(host)).sections['pstack-session']).toBeUndefined();
  });
});

describe('what the extension registers with Pi', () => {
  test('tmux_run and tmux_jobs describe their parameters to the model', () => {
    expect(Object.keys(host.tool('tmux_run').parameters.properties)).toEqual(['name', 'command', 'cwd', 'wake', 'repeat']);
    expect(Object.keys(host.tool('tmux_jobs').parameters.properties)).toEqual(['action', 'ids', 'lines', 'timeout_seconds']);
    expect(host.tool('tmux_run').parameters.properties['wake']?.description).toContain('Message to wake this session with');
    expect(host.tool('tmux_jobs').description).toContain('wait blocks until the named jobs');
  });
});
