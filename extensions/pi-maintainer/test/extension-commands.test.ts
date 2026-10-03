import { tmpdir } from 'node:os';

import { describe, expect, test } from 'vitest';
import maintainerExtension from '../index.ts';
import { createHarness, type MaintainerHarness, type RegisteredCommand } from './helpers/fake-pi.ts';

function command(harness: MaintainerHarness, name: string): RegisteredCommand {
  const found = harness.commands.get(name);
  if (found === undefined) throw new Error(`missing command ${name}`);
  return found;
}

function startSession(harness: MaintainerHarness): Promise<unknown> {
  return harness.emit('session_start', { type: 'session_start', reason: 'startup' });
}

describe('/run', () => {
  test('adds the confirmed output and prefills the editor for a failing command', async () => {
    const harness = createHarness({ confirmAnswer: true, cwd: tmpdir() });
    maintainerExtension(harness.pi);
    await startSession(harness);
    await command(harness, 'run').handler('exit 3', harness.context);
    expect(harness.messages).toHaveLength(1);
    const draft = harness.messages[0] as { customType: string; content: string };
    expect(draft.customType).toBe('maintainer-command-output');
    expect(draft.content.startsWith('I ran this command:\n\nexit 3')).toBe(true);
    expect(harness.editorTexts).toEqual(["What's wrong? Fix"]);
  });

  test('adds nothing when the output question is declined', async () => {
    const harness = createHarness({ confirmAnswer: false, cwd: tmpdir() });
    maintainerExtension(harness.pi);
    await startSession(harness);
    await command(harness, 'run').handler('echo out', harness.context);
    expect(harness.confirmations).toEqual(['Add 0.0k tokens of command output to the chat?']);
    expect(harness.messages).toHaveLength(0);
    expect(harness.editorTexts).toHaveLength(0);
  });
});

describe('/test', () => {
  test('adds the failing output and sends it as the next user message', async () => {
    const harness = createHarness({ cwd: tmpdir() });
    maintainerExtension(harness.pi);
    await startSession(harness);
    await command(harness, 'test').handler('echo FAILED; exit 1', harness.context);
    expect(harness.messages).toHaveLength(1);
    expect(harness.userMessages).toHaveLength(1);
    expect(harness.userMessages[0]).toContain('FAILED');
  });

  test('sends nothing when the command passes', async () => {
    const harness = createHarness({ cwd: tmpdir() });
    maintainerExtension(harness.pi);
    await startSession(harness);
    await command(harness, 'test').handler('exit 0', harness.context);
    expect(harness.messages.length).toBe(0);
    expect(harness.userMessages.length).toBe(0);
  });
});

describe('/lint', () => {
  test('reports a missing repository without opening a repair session', async () => {
    const harness = createHarness({
      exec: async (args) => (args[0] === 'git' && args[1] === 'rev-parse' ? { code: 128, stdout: '' } : { code: 0, stdout: '' }),
    });
    maintainerExtension(harness.pi);
    await startSession(harness);
    await command(harness, 'lint').handler('', harness.context);
    expect(harness.notifications).toEqual([{ message: 'No git repository found.', type: 'error' }]);
  });

  test('warns when the repository has no dirty files', async () => {
    const harness = createHarness({
      exec: async (args) => (args[0] === 'git' && args[1] === 'rev-parse' ? { code: 0, stdout: '/repo\n' } : { code: 0, stdout: '' }),
    });
    maintainerExtension(harness.pi);
    await startSession(harness);
    await command(harness, 'lint').handler('', harness.context);
    expect(harness.notifications).toEqual([{ message: 'No dirty files to lint.', type: 'warning' }]);
  });
});

describe('one-shot --lint', () => {
  test('runs the lint flow on startup and shuts down when nothing is dirty', async () => {
    const harness = createHarness({
      flags: { lint: true },
      exec: async (args) => (args[0] === 'git' && args[1] === 'rev-parse' ? { code: 0, stdout: '/repo\n' } : { code: 0, stdout: '' }),
    });
    maintainerExtension(harness.pi);
    await startSession(harness);
    expect(harness.notifications).toEqual([{ message: 'No dirty files to lint.', type: 'warning' }]);
    expect(harness.shutdowns()).toBe(1);
  });

  test('ignores a non-startup session', async () => {
    const harness = createHarness({ flags: { lint: true } });
    maintainerExtension(harness.pi);
    await harness.emit('session_start', { type: 'session_start', reason: 'reload' });
    expect(harness.shutdowns()).toBe(0);
  });
});

describe('turn_end with auto-test', () => {
  test('reflects the failing test output after an edit', async () => {
    const harness = createHarness({ flags: { 'auto-test': true, 'test-cmd': 'exit 1' }, confirmAnswer: true });
    maintainerExtension(harness.pi);
    await startSession(harness);
    await harness.emit('turn_start', { type: 'turn_start', turnIndex: 0, timestamp: 0 });
    await harness.emit('tool_call', { type: 'tool_call', toolName: 'edit', input: { path: 'missing.py' } });
    const result = (await harness.emit('turn_end', { type: 'turn_end', outcome: 'completed' })) as {
      entries: ReadonlyArray<{ customType: string }>;
      continue?: boolean;
    };
    expect(result.continue).toBe(true);
    expect(result.entries.map((entry) => entry.customType)).toEqual(['maintainer-command-output', 'maintainer-reflection']);
  });
});

describe('before_agent_start', () => {
  test('publishes the configured lint and test commands into the prompt', async () => {
    const harness = createHarness({ flags: { 'lint-cmd': 'python: flake8', 'test-cmd': 'pytest', 'auto-test': true } });
    maintainerExtension(harness.pi);
    await startSession(harness);
    const sections: Record<string, string> = {};
    await harness.emit('before_agent_start', { type: 'before_agent_start', systemPromptOptions: { sections } });
    expect(sections['maintainer-lint-test']).toBe("- The user's pre-commit runs these lint commands, don't suggest running them:\n  - python: flake8\n- The user's pre-commit runs this test command, don't suggest running them: pytest\n");
  });

  test('clears the prompt section when no commands are configured', async () => {
    const harness = createHarness();
    maintainerExtension(harness.pi);
    await startSession(harness);
    const sections: Record<string, string> = { 'maintainer-lint-test': 'stale' };
    await harness.emit('before_agent_start', { type: 'before_agent_start', systemPromptOptions: { sections } });
    expect(sections).toEqual({});
  });
});

describe('agent_settled', () => {
  test('does nothing without a one-shot run', async () => {
    const harness = createHarness();
    maintainerExtension(harness.pi);
    await harness.emit('agent_settled', { type: 'agent_settled' });
    expect(harness.shutdowns()).toBe(0);
    expect(harness.userMessages.length).toBe(0);
  });
});
