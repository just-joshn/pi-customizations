import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Key } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { double, type TestHarness, useTestHarness } from './harness.ts';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const REVIEWER_BODY = 'Review every diff.';

interface ContextMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
  readonly details?: { readonly runId?: string };
}

function writeSkill(h: TestHarness, name: string, frontmatter: readonly string[], body: string): string {
  const filePath = join(h.cwd, '.pi', 'skills', name, 'SKILL.md');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} skill\n${frontmatter.join('\n')}\n---\n\n${body}\n`, 'utf-8');
  return filePath;
}

async function startWith(...skills: readonly { name: string; frontmatter: readonly string[]; body: string }[]): Promise<TestHarness> {
  const h = useTestHarness();
  const commands = skills.map((skill) => {
    writeSkill(h, skill.name, skill.frontmatter, skill.body);
    return { name: skill.name, path: `.pi/skills/${skill.name}/SKILL.md`, description: `${skill.name} skill` };
  });
  h.setSkillCommands(commands);
  await h.emit('session_start', {});
  return h;
}

async function startReviewer(frontmatter: readonly string[] = [], body = REVIEWER_BODY): Promise<TestHarness> {
  return startWith({ name: 'reviewer', frontmatter, body });
}

function contextMessages(results: readonly unknown[]): readonly ContextMessage[] {
  return results.flatMap((result) => {
    const message = double<{ message?: ContextMessage } | undefined>(result)?.message;
    return message ? [message] : [];
  });
}

async function userTurn(h: TestHarness, prompt: string): Promise<readonly ContextMessage[]> {
  return contextMessages(await h.emitAll('before_agent_start', { messageType: 'user', prompt }));
}

function skillFile(h: TestHarness, name: string): string {
  return join(h.cwd, '.pi', 'skills', name, 'SKILL.md');
}

describe('custom mode activation and deactivation', () => {
  it('shows the custom mode in the status line and notifies on entry', async () => {
    const h = await startReviewer(['icon: "⚡"', 'color: magenta'], 'Review every diff before it ships.');

    await h.runCommand('mode', 'reviewer');

    expect(h.getStatuses()['pi-modes']).toContain('⚡ Reviewer');
    expect(h.getStatuses()['pi-modes']).toContain('ctrl+alt+m to exit');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Reviewer custom mode');
  });

  it('attaches the entered skill block once on the entering turn', async () => {
    const h = await startReviewer(['icon: "⚡"', 'color: magenta'], 'Review every diff before it ships.');
    await h.runCommand('mode', 'reviewer');

    const entered = await userTurn(h, 'start reviewing');
    const enteredMessage = entered.find((message) => message.customType === 'pi-modes-custom-mode');
    expect(enteredMessage?.content).toContain('The user has entered Reviewer custom mode.');
    expect(enteredMessage?.content).toContain('<skill name="reviewer"');
    expect(enteredMessage?.content).toContain('Review every diff before it ships.');
    expect(enteredMessage?.display).toBe(true);
  });

  it('keeps a sticky reminder without the skill block on later turns', async () => {
    const h = await startReviewer(['icon: "⚡"', 'color: magenta'], 'Review every diff before it ships.');
    await h.runCommand('mode', 'reviewer');
    await userTurn(h, 'start reviewing');

    const reminder = await userTurn(h, 'second turn');
    expect(reminder).toContainEqual(expect.objectContaining({ customType: 'pi-modes-custom-mode-reminder', content: expect.stringContaining("Reminder: you are still in Reviewer mode. Follow that mode's skill on this turn.") }));
    expect(reminder.map((message) => message.content).join('\n')).not.toContain('<skill name=');
  });

  it('persists the active lifecycle after the entering turn', async () => {
    const h = await startReviewer(['icon: "⚡"', 'color: magenta'], 'Review every diff before it ships.');
    await h.runCommand('mode', 'reviewer');
    await userTurn(h, 'start reviewing');

    const entry = h.getEntries().at(-ONE);
    expect(entry?.customType).toBe('pi-modes-state');
    expect((entry?.data as { customMode?: { lifecycle?: string } } | undefined)?.customMode?.lifecycle).toBe('active');
  });

  it('deactivates the custom mode and states the exit exactly once', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');
    await userTurn(h, 'first turn');

    await h.runCommand('mode', 'off');
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getNotifications().at(-ONE)?.message).toContain('disabled');

    const exited = await userTurn(h, 'back to normal');
    expect(exited).toContainEqual(expect.objectContaining({ content: expect.stringContaining('The user has exited Reviewer custom mode.') }));

    const afterExit = await userTurn(h, 'later turn');
    expect(afterExit.map((message) => message.content).join('\n')).not.toContain('custom mode');
  });

  it('switches between custom modes by closing the old mode and entering the new one in one turn', async () => {
    const h = await startWith({ name: 'reviewer', frontmatter: [], body: 'Review every diff.' }, { name: 'planner', frontmatter: ['color: green'], body: 'Plan before coding.' });
    await h.runCommand('mode', 'reviewer');
    await userTurn(h, 'first turn');
    await h.runCommand('mode', 'planner');

    const switched = (await userTurn(h, 'switch please')).map((message) => message.content).join('\n');
    expect(switched).toContain('The user has exited Reviewer custom mode.');
    expect(switched).toContain('The user has entered Planner custom mode.');
    expect(switched).toContain('Plan before coding.');
    expect(h.getStatuses()['pi-modes']).toContain('Planner');
  });
});

describe('custom mode icon and color selection', () => {
  it('writes a color argument into SKILL.md frontmatter', async () => {
    const h = await startReviewer();
    const skillPath = skillFile(h, 'reviewer');
    await h.runCommand('mode', 'reviewer');

    await h.runCommand('mode', 'color cyan');
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('color: "cyan"');
    expect(written).toContain(REVIEWER_BODY);
  });

  it('writes an icon argument into SKILL.md frontmatter and the status badge', async () => {
    const h = await startReviewer();
    const skillPath = skillFile(h, 'reviewer');
    await h.runCommand('mode', 'reviewer');

    await h.runCommand('mode', 'icon ★');
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('icon: "★"');
    expect(written).toContain(REVIEWER_BODY);
    expect(h.getStatuses()['pi-modes']).toContain('★ Reviewer');
  });

  it('rejects unknown colors without touching the skill file', async () => {
    const h = await startReviewer(['color: red']);
    const skillPath = skillFile(h, 'reviewer');
    await h.runCommand('mode', 'reviewer');
    await h.runCommand('mode', 'color chartreuse');

    expect(readFileSync(skillPath, 'utf-8')).toContain('color: red');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Unknown color');
  });

  it('applies a color chosen from the picker', async () => {
    const h = useTestHarness({ selectResponses: ['magenta'] });
    const skillPath = writeSkill(h, 'reviewer', [], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md' }]);
    await h.emit('session_start', {});
    await h.runCommand('mode', 'reviewer');

    await h.runCommand('mode', 'color');
    expect(readFileSync(skillPath, 'utf-8')).toContain('color: "magenta"');
  });

  it('applies an icon chosen from the picker', async () => {
    const h = useTestHarness({ selectResponses: ['◆'] });
    writeSkill(h, 'reviewer', [], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md' }]);
    await h.emit('session_start', {});
    await h.runCommand('mode', 'reviewer');

    await h.runCommand('mode', 'icon');
    expect(h.getStatuses()['pi-modes']).toContain('◆ Reviewer');
  });
});

describe('custom mode picker cancellation', () => {
  it.for(['', 'color', 'icon'])('leaves state and SKILL.md untouched when the %s picker is cancelled', async (args) => {
    const h = useTestHarness({ selectResponses: [undefined] });
    const skillPath = writeSkill(h, 'reviewer', [], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md' }]);
    await h.emit('session_start', {});
    await h.runCommand('mode', 'reviewer');
    const before = readFileSync(skillPath, 'utf-8');
    const entries = JSON.stringify(h.getEntries());
    const status = h.getStatuses()['pi-modes'];

    await h.runCommand('mode', args);

    expect(readFileSync(skillPath, 'utf-8')).toBe(before);
    expect(JSON.stringify(h.getEntries())).toBe(entries);
    expect(h.getStatuses()['pi-modes']).toBe(status);
  });
});

describe('custom mode picker and cycling', () => {
  it('lists built-in modes and custom modes in the picker and activates the chosen custom mode', async () => {
    const h = useTestHarness({ selectResponses: ['⚡ Reviewer — Reviews diffs'] });
    writeSkill(h, 'reviewer', ['icon: "⚡"'], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md', description: 'Reviews diffs' }]);
    await h.emit('session_start', {});

    await h.runCommand('mode');
    expect(h.getStatuses()['pi-modes']).toContain('⚡ Reviewer');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Reviewer custom mode');
  });

  it('exits the custom mode on the cycle shortcut instead of cycling execution modes', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');

    await h.triggerShortcut(String(Key.ctrlAlt('m')));
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getActiveTools()).toContain('edit');
  });

  it('keeps read-only enforcement while a custom mode is active', async () => {
    const h = await startReviewer();
    await h.runCommand('ask');
    await h.runCommand('mode', 'reviewer');

    const blocked = double<{ block?: boolean; reason?: string } | undefined>(await h.emit('tool_call', { toolName: 'edit', toolCallId: 't1', input: { path: 'a.ts' } }));
    expect(blocked?.block).toBe(true);
    expect(h.getStatuses()['pi-modes']).toContain('Reviewer');
  });
});

describe('one-message skill invocation', () => {
  it('attaches a referenced skill to that single message only', async () => {
    const h = await startReviewer([], 'Review every diff before it ships.');

    const referenced = await userTurn(h, 'please /reviewer this patch');
    const skillMessage = referenced.find((message) => message.customType === 'pi-modes-skill');
    expect(skillMessage?.content).toContain('<skill name="reviewer"');
    expect(skillMessage?.content).toContain('Review every diff before it ships.');

    const plain = await userTurn(h, 'unrelated follow-up');
    expect(plain.map((message) => message.customType)).not.toContain('pi-modes-skill');
  });

  it('does not attach anything for paths that merely contain a slash', async () => {
    const h = await startReviewer();
    const plain = await userTurn(h, 'open src/reviewer and docs/reviewer.md');
    expect(plain.map((message) => message.customType)).not.toContain('pi-modes-skill');
  });
});

describe('custom mode startup and restore', () => {
  it('activates a custom mode from the --mode flag', async () => {
    const h = useTestHarness({ flags: { mode: 'reviewer' } });
    writeSkill(h, 'reviewer', ['icon: "⚡"'], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md' }]);

    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('⚡ Reviewer');
  });

  it('restores a persisted custom mode as active after a session restart', async () => {
    const h = useTestHarness({
      initialEntries: [
        {
          type: 'custom',
          customType: 'pi-modes-state',
          data: {
            mode: 'agent',
            customMode: {
              id: 'reviewer',
              label: 'Reviewer',
              filePath: join('/repo/.pi/skills/reviewer/SKILL.md'),
              description: 'Reviews diffs',
              icon: '⚡',
              colorId: 'red',
              body: REVIEWER_BODY,
              lifecycle: 'active',
            },
          },
        },
      ],
    });
    writeSkill(h, 'reviewer', ['icon: "⚡"', 'color: red'], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md' }]);

    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('⚡ Reviewer');

    const reminder = await userTurn(h, 'keep going');
    expect(reminder).toContainEqual(expect.objectContaining({ content: expect.stringContaining('Reminder: you are still in Reviewer mode.') }));
  });

  it('reports unknown mode names without changing state', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'does-not-exist');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Unknown mode');
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
  });

  it('works without a UI by keeping state and skipping widgets', async () => {
    const h = useTestHarness({ hasUI: false });
    writeSkill(h, 'reviewer', [], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md' }]);
    await h.emit('session_start', {});

    await h.runCommand('mode', 'reviewer');
    const entered = await userTurn(h, 'go');
    expect(entered).toContainEqual(expect.objectContaining({ content: expect.stringContaining('The user has entered Reviewer custom mode.') }));
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getWidgets()).toEqual({});
  });
});

describe('custom mode skill discovery resilience', () => {
  it('ignores unreadable skill files and keeps working', async () => {
    const h = useTestHarness();
    h.setSkillCommands([{ name: 'ghost', path: '.pi/skills/ghost/SKILL.md' }]);
    await h.emit('session_start', {});

    await h.runCommand('mode', 'ghost');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Unknown mode');
    expect(h.getNotifications().map((note) => note.level)).not.toContain('error');
  });

  it('finds no custom modes when no skill commands are registered', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('mode', 'anything');
    expect(h.getNotifications().at(-ONE)?.message).toContain('Unknown mode');
    expect(
      h
        .getNotifications()
        .map((note) => note.message)
        .join('\n'),
    ).not.toContain('undefined');
  });
});

describe('custom mode turn context', () => {
  it('keeps this run own injections through a steer', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');

    const entered = await userTurn(h, 'start reviewing');
    const runId = entered.find((message) => message.customType === 'pi-modes-custom-mode')?.details?.runId;
    expect(runId).toBeDefined();

    const sameRun = double<{ messages: readonly { customType?: string }[] }>(
      await h.emit('context', {
        messages: [
          { role: 'user', content: 'start reviewing' },
          { customType: 'pi-modes-custom-mode', content: 'entered', details: { runId } },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'now edit the file' },
        ],
      }),
    );
    expect(sameRun.messages.map((message) => message.customType)).toContain('pi-modes-custom-mode');
  });

  it('drops earlier runs when a new custom-mode run starts', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');
    const entered = await userTurn(h, 'start reviewing');
    const runId = entered.find((message) => message.customType === 'pi-modes-custom-mode')?.details?.runId;
    expect(runId).toBeDefined();

    const second = await userTurn(h, 'second turn');
    const reminderRunId = second.find((message) => message.customType === 'pi-modes-custom-mode-reminder')?.details?.runId;
    expect(reminderRunId).toBeDefined();
    expect(reminderRunId).not.toBe(runId);

    const nextRun = double<{ messages: readonly { customType?: string }[] }>(
      await h.emit('context', {
        messages: [
          { role: 'user', content: 'start reviewing' },
          { customType: 'pi-modes-custom-mode', content: 'entered', details: { runId } },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'second turn' },
          { customType: 'pi-modes-custom-mode-reminder', content: 'reminder', details: { runId: reminderRunId } },
        ],
      }),
    );
    expect(nextRun.messages.flatMap((message) => (message.customType === undefined ? [] : [message.customType]))).toEqual(['pi-modes-custom-mode-reminder']);
  });

  it('keeps an injection that carries this run nonce and drops one that does not', async () => {
    const h = await startReviewer();
    await h.runCommand('ask');
    const turn = await userTurn(h, 'go');
    const runId = turn.find((message) => message.customType === 'pi-modes-context')?.details?.runId;
    expect(runId).toBeDefined();

    const filtered = double<{ messages: readonly { customType?: string }[] }>(
      await h.emit('context', {
        messages: [
          { customType: 'pi-modes-context', content: 'current', details: { runId } },
          { customType: 'pi-modes-custom-mode-reminder', content: 'stale' },
        ],
      }),
    );

    expect(filtered.messages).toHaveLength(ONE);
  });

  it('never drops user content that quotes a mode banner', async () => {
    const h = await startReviewer();

    const filtered = double<{ messages: readonly { content?: string }[] }>(await h.emit('context', { messages: [{ role: 'user', content: 'What does [PLAN MODE ACTIVE] mean?' }] }));

    expect(filtered.messages).toHaveLength(ONE);
    expect(filtered.messages[ZERO]?.content).toBe('What does [PLAN MODE ACTIVE] mean?');
  });
});

describe('custom mode command arguments', () => {
  it('enters a custom mode and submits the rest of the command as the first prompt', async () => {
    const h = await startReviewer();

    await h.runCommand('mode', 'reviewer review this diff');
    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('review this diff');
    expect(h.getStatuses()['pi-modes']).toContain('Reviewer');

    const entered = await userTurn(h, 'review this diff');
    expect(entered.map((message) => message.customType)).toContain('pi-modes-custom-mode');
  });

  it.for(['off', 'color cyan', 'icon ★'])('reports that no custom mode is active for /mode %s', async (args) => {
    const h = await startReviewer();

    await h.runCommand('mode', args);
    expect(h.getNotifications().at(-ONE)?.message).toContain('No custom mode is active.');
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
  });
});

describe('custom mode request hygiene', () => {
  it('does not attach a second copy of the skill the active custom mode already carries', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');

    const entered = await userTurn(h, 'please /reviewer this patch');
    expect(entered.filter((message) => message.customType === 'pi-modes-custom-mode')).toHaveLength(ONE);
    expect(entered.map((message) => message.customType)).not.toContain('pi-modes-skill');

    const reminder = await userTurn(h, 'and again /reviewer');
    expect(reminder.map((message) => message.customType)).not.toContain('pi-modes-skill');
  });

  it('still attaches a referenced skill that is not the active mode', async () => {
    const h = await startWith({ name: 'reviewer', frontmatter: [], body: REVIEWER_BODY }, { name: 'planner', frontmatter: [], body: 'Plan before coding.' });
    await h.runCommand('mode', 'planner');

    const turn = await userTurn(h, 'use /reviewer here');
    const reference = turn.find((message) => message.customType === 'pi-modes-skill');
    expect(reference?.content).toContain(REVIEWER_BODY);
    expect(turn.map((message) => message.customType)).toContain('pi-modes-custom-mode');
  });
});

describe('custom mode startup validation', () => {
  it('warns about an unknown --mode value and keeps the restored mode', async () => {
    const h = useTestHarness({
      flags: { mode: 'plna' },
      initialEntries: [{ type: 'custom', customType: 'pi-modes-state', data: { mode: 'ask', toolsBeforeRestricted: ['read', 'bash', 'edit', 'write'] } }],
    });
    writeSkill(h, 'reviewer', [], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md' }]);

    await h.emit('session_start', {});
    expect(h.getNotifications().at(-ONE)?.message).toContain('Unknown mode "plna"');
    expect(h.getStatuses()['pi-modes']).toContain('Ask');
    expect(h.getActiveTools()).not.toContain('edit');
  });
});

describe('custom mode appearance validation', () => {
  it('rejects an icon longer than the badge can show and leaves the skill file untouched', async () => {
    const h = await startReviewer();
    const skillPath = skillFile(h, 'reviewer');
    await h.runCommand('mode', 'reviewer');
    const before = readFileSync(skillPath, 'utf-8');

    await h.runCommand('mode', 'icon 123456789');
    expect(readFileSync(skillPath, 'utf-8')).toBe(before);
    expect(h.getNotifications().at(-ONE)?.message).toContain('characters or fewer');
    expect(h.getStatuses()['pi-modes']).toContain('Reviewer');
  });
});

describe('custom mode and execution mode indicators', () => {
  it('shows the execution mode beside the custom mode badge while tools stay gated', async () => {
    const h = await startReviewer();
    await h.runCommand('ask');
    await h.runCommand('mode', 'reviewer');

    expect(h.getStatuses()['pi-modes']).toContain('Reviewer');
    expect(h.getStatuses()['pi-modes-execution']).toContain('Ask');

    await h.runCommand('agent');
    expect(h.getStatuses()['pi-modes']).toContain('Reviewer');
    expect(h.getStatuses()['pi-modes-execution']).toBeUndefined();
  });
});

describe('custom mode command completions', () => {
  it('offers builtin modes, custom modes, and the /mode verbs', async () => {
    const h = await startReviewer();

    const all = await h.getCompletions('mode', '');
    expect((all ?? []).map((item) => item.value)).toEqual(expect.arrayContaining(['agent', 'plan', 'debug', 'ask', 'off', 'color', 'icon', 'reviewer']));
  });

  it('filters /mode completions to the matching prefix', async () => {
    const h = await startReviewer();

    const filtered = await h.getCompletions('mode', 're');
    expect((filtered ?? []).map((item) => item.value)).toEqual(['reviewer']);
  });
});

describe('reserved mode names', () => {
  it('keeps Plan mode at startup when a skill is also named plan', async () => {
    const startup = useTestHarness({ flags: { mode: 'plan' } });
    writeSkill(startup, 'plan', [], 'Rewrite files immediately.');
    startup.setSkillCommands([{ name: 'plan', path: '.pi/skills/plan/SKILL.md' }]);
    await startup.emit('session_start', {});

    expect(startup.getStatuses()['pi-modes']).toContain('Plan (ctrl+alt+m to cycle)');
    expect(startup.getActiveTools()).not.toContain('edit');
    expect(startup.getActiveTools()).toContain('create_plan');
  });

  it('keeps Plan mode when /mode plan includes a prompt', async () => {
    const command = await startWith({ name: 'plan', frontmatter: [], body: 'Rewrite files immediately.' });
    await command.runCommand('mode', 'plan fix the bug');
    expect(command.getSentUserMessages().at(-ONE)?.content).toBe('fix the bug');
    expect(command.getActiveTools()).not.toContain('edit');
    expect(command.getActiveTools()).not.toContain('write');
    expect(command.getStatuses()['pi-modes']).not.toContain('custom mode');
  });
});

describe('custom mode names and prompts', () => {
  it('does not submit a fragment of a multi-word mode title as a prompt', async () => {
    const h = await startWith({ name: 'deep-review', frontmatter: ['title: Deep Review'], body: 'Review deeply.' });

    await h.runCommand('mode', 'deep review');
    expect(h.getSentUserMessages()).toHaveLength(ZERO);
    expect(h.getStatuses()['pi-modes']).toContain('Deep Review');
  });

  it('submits the rest of a skill id as the prompt', async () => {
    const h = await startWith({ name: 'deep-review', frontmatter: ['title: Deep Review'], body: 'Review deeply.' });

    await h.runCommand('mode', 'deep-review review this');
    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('review this');
    expect(h.getStatuses()['pi-modes']).toContain('Deep Review');
  });

  it('activates the picked mode when two skills render the same picker row', async () => {
    const h = useTestHarness({ selectResponses: ['Reviewer — Reviews diffs (reviewer-b)'] });
    writeSkill(h, 'reviewer-a', ['title: Reviewer'], 'First reviewer body.');
    writeSkill(h, 'reviewer-b', ['title: Reviewer'], 'Second reviewer body.');
    h.setSkillCommands([
      { name: 'reviewer-a', path: '.pi/skills/reviewer-a/SKILL.md', description: 'Reviews diffs' },
      { name: 'reviewer-b', path: '.pi/skills/reviewer-b/SKILL.md', description: 'Reviews diffs' },
    ]);
    await h.emit('session_start', {});

    await h.runCommand('mode');
    const entered = await userTurn(h, 'start');
    expect(entered).toContainEqual(expect.objectContaining({ content: expect.stringContaining('Second reviewer body.') }));
  });
});

describe('custom mode runs and compaction', () => {
  it('starts a fresh run for a custom trigger and keeps the active mode reminder', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');
    const entered = await userTurn(h, 'start');
    const runId = entered.find((message) => message.customType === 'pi-modes-custom-mode')?.details?.runId;
    expect(runId).toBeDefined();

    const onCustom = contextMessages(await h.emitAll('before_agent_start', { messageType: 'custom', message: { customType: 'pi-modes-plan-complete' } }));
    expect(onCustom.map(({ content }) => content).join('\n')).toContain('Reminder: you are still in Reviewer mode');

    const filtered = double<{ messages: readonly { customType?: string }[] }>(
      await h.emit('context', {
        messages: [
          { role: 'user', content: 'start' },
          { customType: 'pi-modes-custom-mode', content: 'entered', details: { runId } },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'queued follow-up' },
        ],
      }),
    );
    expect(filtered.messages.map((message) => message.customType).filter(Boolean)).toEqual(['pi-modes-custom-mode-reminder']);
  });

  it('enters an exact title that starts with an appearance verb', async () => {
    const h = await startWith({ name: 'color-palette', frontmatter: ['title: Color Palette'], body: 'Name the palette.' });
    await h.runCommand('mode', 'Color Palette');
    expect(h.getStatuses()['pi-modes']).toContain('Color Palette');
    const injected = await userTurn(h, 'choose a palette');
    expect(injected.map(({ content }) => content).join('\n')).toContain('Name the palette.');
  });

  it('replays one-message skill guidance after compaction and discards it on a new run', async () => {
    const h = await startReviewer();
    const injected = await userTurn(h, 'Check this with /reviewer');
    const skill = injected.find((message) => message.customType === 'pi-modes-skill');
    expect(skill?.content).toContain(REVIEWER_BODY);
    const compacted = { messages: [{ role: 'compactionSummary', summary: 'The user requests a review.' }] };
    const restored = double<{ messages: readonly ContextMessage[] }>(await h.emit('context', compacted));
    expect(restored.messages.find((message) => message.customType === 'pi-modes-skill')?.content).toBe(skill?.content);

    await userTurn(h, 'now explain something else');
    const later = double<{ messages: readonly ContextMessage[] }>(await h.emit('context', compacted));
    expect(later.messages.map((message) => message.customType)).not.toContain('pi-modes-skill');
  });

  it('includes a mid-run custom mode switch once and restores its exact guidance after compaction', async () => {
    const h = await startWith({ name: 'reviewer', frontmatter: [], body: REVIEWER_BODY }, { name: 'planner', frontmatter: [], body: 'Plan the change.' });
    await h.runCommand('mode', 'reviewer');
    await userTurn(h, 'start reviewing');
    await h.runCommand('mode', 'planner');

    const nextRequest = double<{ messages: readonly ContextMessage[] }>(await h.emit('context', { messages: [] }));
    const transition = nextRequest.messages.find((message) => message.customType === 'pi-modes-custom-mode');
    expect(transition?.content).toContain('has exited Reviewer');
    expect(transition?.content).toContain('Plan the change.');
    const afterCompaction = double<{ messages: readonly ContextMessage[] }>(await h.emit('context', { messages: [] }));
    expect(afterCompaction.messages.find((message) => message.customType === 'pi-modes-custom-mode')?.content).toBe(transition?.content);

    const later = (await userTurn(h, 'keep planning')).map(({ content }) => content).join('\n');
    expect(later).toContain('Reminder: you are still in Planner mode');
    expect(later).not.toContain('has exited Reviewer');
  });

  it('restores the guidance when compaction drops it mid-run', async () => {
    const h = await startReviewer();
    await h.runCommand('ask');
    const injected = await userTurn(h, 'start');
    const runId = injected.find((message) => message.customType === 'pi-modes-context')?.details?.runId;

    const filtered = double<{ messages: readonly { customType?: string; content?: string; details?: { runId?: string } }[] }>(
      await h.emit('context', {
        messages: [
          { role: 'user', content: 'continue the investigation' },
          { role: 'assistant', content: 'I will edit the file.' },
        ],
      }),
    );
    const restored = filtered.messages.find((message) => message.customType === 'pi-modes-context');
    expect(restored?.content).toContain('[ASK MODE ACTIVE]');
    expect(restored?.details?.runId).toBe(runId);
  });

  it('restores the entered skill block, not the reminder, after compaction on the entering run', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');
    const entered = await userTurn(h, 'start');
    const runId = entered.find((message) => message.customType === 'pi-modes-custom-mode')?.details?.runId;
    expect(runId).toBeDefined();

    const filtered = double<{ messages: readonly { customType?: string; content?: string; details?: { runId?: string } }[] }>(await h.emit('context', { messages: [{ role: 'user', content: 'start' }] }));
    const restored = filtered.messages.filter((message) => message.customType?.startsWith('pi-modes-custom-mode'));
    expect(restored.map((message) => message.customType)).toEqual(['pi-modes-custom-mode']);
    expect(restored[ZERO]?.content).toContain('<skill name="reviewer"');
    expect(restored[ZERO]?.details?.runId).toBe(runId);
  });

  it('restores only the reminder after compaction on a later run', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');
    await userTurn(h, 'start');
    await userTurn(h, 'later');

    const filtered = double<{ messages: readonly { customType?: string; content?: string }[] }>(await h.emit('context', { messages: [] }));
    const custom = filtered.messages.filter((message) => message.customType?.startsWith('pi-modes-custom-mode'));
    const joined = custom.map((message) => message.content).join('\n');
    expect(joined).toContain('Reminder: you are still in Reviewer mode');
    expect(joined).not.toContain('<skill name="reviewer"');
  });

  it('keeps the entered skill on the same run when only the execution mode changes', async () => {
    const h = useTestHarness({ selectResponses: ['Approve mode switch'] });
    writeSkill(h, 'reviewer', [], REVIEWER_BODY);
    h.setSkillCommands([{ name: 'reviewer', path: '.pi/skills/reviewer/SKILL.md', description: 'reviewer skill' }]);
    await h.emit('session_start', {});
    await h.runCommand('mode', 'reviewer');
    const entered = await userTurn(h, 'start');
    const carried = entered.map((message) => ({ role: 'custom', customType: message.customType, content: message.content, details: message.details, display: message.display }));

    await h.callTool('switch_mode', { target_mode_id: 'ask' });
    const after = double<{ messages: readonly { content?: string }[] }>(await h.emit('context', { messages: carried }));
    const joined = after.messages.map((message) => String(message.content)).join('\n');
    expect(joined).toContain('[ASK MODE ACTIVE]');
    expect(joined).toContain('The user has entered Reviewer custom mode.');
    expect(joined).toContain(REVIEWER_BODY);
  });
});

describe('custom mode persistence size', () => {
  it('does not append an unchanged snapshot on every turn', async () => {
    const h = await startReviewer();
    await h.runCommand('mode', 'reviewer');
    expect(h.getEntries()).toHaveLength(ONE);

    await userTurn(h, 'one');
    await userTurn(h, 'two');
    await userTurn(h, 'three');
    expect(h.getEntries()).toHaveLength(TWO);
  });
});

describe('mode names that collide with built-in surfaces', () => {
  it('enters a skill named after a compatibility alias', async () => {
    const h = await startWith({ name: 'chat', frontmatter: [], body: 'Chat skill rules.' });
    await h.runCommand('mode', 'chat');
    expect(h.getStatuses()['pi-modes']).toContain('Chat');

    const entered = await userTurn(h, 'go');
    expect(entered).toContainEqual(expect.objectContaining({ content: expect.stringContaining('Chat skill rules.') }));
  });

  it('enters the custom mode whose picker row matches a built-in row', async () => {
    const h = useTestHarness({ selectResponses: ['Plan — Read-only exploration and structured planning (no edits) (plan-skill)'] });
    writeSkill(h, 'plan-skill', ['title: Plan'], 'Custom plan rules.');
    h.setSkillCommands([{ name: 'plan-skill', path: '.pi/skills/plan-skill/SKILL.md', description: 'Read-only exploration and structured planning (no edits)' }]);
    await h.emit('session_start', {});

    await h.runCommand('mode');
    expect(h.getStatuses()['pi-modes']).toContain('(ctrl+alt+m to exit)');

    const entered = await userTurn(h, 'go');
    expect(entered).toContainEqual(expect.objectContaining({ content: expect.stringContaining('Custom plan rules.') }));
  });
});
