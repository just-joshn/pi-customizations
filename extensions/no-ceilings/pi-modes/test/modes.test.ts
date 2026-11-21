import { Key } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './harness.ts';

const ONE = 1;

let harnesses: readonly TestHarness[] = [];

function track(harness: TestHarness): TestHarness {
  harnesses = [...harnesses, harness];
  return harness;
}

afterEach(async () => {
  const current = harnesses;
  harnesses = [];
  for (const h of current) {
    await h.cleanup();
  }
});

describe('pi-modes cycling and guards', () => {
  it('cycles through all 4 modes via Ctrl+Alt+M in exact parity order', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toBeUndefined();

    await h.triggerShortcut(String(Key.ctrlAlt('m')));
    expect(h.getStatuses()['pi-modes']).toContain('Plan');
    expect(h.getActiveTools()).not.toContain('edit');
    expect(h.getActiveTools()).toContain('create_plan');

    await h.triggerShortcut(String(Key.ctrlAlt('m')));
    expect(h.getStatuses()['pi-modes']).toContain('Debug');
    expect(h.getActiveTools()).toContain('edit');

    await h.triggerShortcut(String(Key.ctrlAlt('m')));
    expect(h.getStatuses()['pi-modes']).toContain('Ask');
    expect(h.getActiveTools()).not.toContain('write');

    await h.triggerShortcut(String(Key.ctrlAlt('m')));
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getActiveTools()).toContain('write');
  });

  it('blocks write tools and mutating bash commands in Ask and Plan modes', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    await h.runCommand('ask');

    const editBlock = (await h.emit('tool_call', { toolName: 'edit', toolCallId: 't1', input: { path: 'a.ts' } })) as { block?: boolean; reason?: string } | undefined;
    expect(editBlock?.block).toBe(true);
    expect(editBlock?.reason).toContain('Ask mode is read-only');

    const rmBlock = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 't2', input: { command: 'rm -rf dist' } })) as { block?: boolean } | undefined;
    expect(rmBlock?.block).toBe(true);

    const gitStatusAllow = await h.emit('tool_call', { toolName: 'bash', toolCallId: 't3', input: { command: 'git status' } });
    expect(gitStatusAllow).toBeUndefined();

    await h.runCommand('agent');
    const rmAllowed = await h.emit('tool_call', { toolName: 'bash', toolCallId: 't4', input: { command: 'rm -rf dist' } });
    expect(rmAllowed).toBeUndefined();
  });
});

describe('pi-modes flags, switch_mode tool, and persistence', () => {
  it('supports CLI flags, slash commands with prompts, and Cursor mode aliases', async () => {
    const h = track(createTestHarness({ flags: { plan: true } }));
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('Plan');

    await h.runCommand('mode', 'search');
    expect(h.getStatuses()['pi-modes']).toContain('Ask');

    await h.runCommand('ask', 'Explain the architecture');
    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('Explain the architecture');

    await h.runCommand('ask');
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
  });

  it('handles switch_mode tool approval, rejection, and headless auto-approval', async () => {
    const interactive = track(createTestHarness({ selectResponses: ['Reject', 'Approve mode switch'] }));
    await interactive.emit('session_start', {});

    const rejected = await interactive.callTool('switch_mode', { target_mode_id: 'ask', explanation: 'Read-only Q&A' });
    expect(rejected.details?.['status']).toBe('rejected');

    const approved = await interactive.callTool('switch_mode', { target_mode_id: 'plan', explanation: 'Plan refactor' });
    expect(approved.details?.['status']).toBe('success');
    expect(interactive.getStatuses()['pi-modes']).toContain('Plan');

    const headless = track(createTestHarness({ hasUI: false }));
    await headless.emit('session_start', {});
    const auto = await headless.callTool('switch_mode', { target_mode_id: 'ask' });
    expect(auto.details?.['status']).toBe('success');
    expect(headless.getActiveTools()).not.toContain('write');
  });

  it('strips stale mode context messages and restores persisted mode on resume', async () => {
    const initialEntries = [{ type: 'custom', customType: 'pi-modes-state', data: { mode: 'ask', toolsBeforeRestricted: ['read', 'bash', 'edit', 'write'] } }];
    const h = track(createTestHarness({ initialEntries }));
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('Ask');

    const filtered = (await h.emit('context', {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'custom', customType: 'pi-modes-context', content: '[ASK MODE ACTIVE]' },
        { role: 'user', content: '[PLAN MODE ACTIVE] old' },
      ],
    })) as { messages: readonly unknown[] };
    expect(filtered.messages).toHaveLength(ONE);
  });
});

describe('pi-modes regression guards', () => {
  it('blocks chained commands, command substitution, and find -delete in read-only modes', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    await h.runCommand('ask');

    const chained = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'c1', input: { command: 'echo ok && node -e "process.exit(0)"' } })) as { block?: boolean } | undefined;
    expect(chained?.block).toBe(true);

    const subshell = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'c2', input: { command: 'echo $(whoami)' } })) as { block?: boolean } | undefined;
    expect(subshell?.block).toBe(true);

    const findDelete = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'c3', input: { command: 'find . -name "*.tmp" -delete' } })) as { block?: boolean } | undefined;
    expect(findDelete?.block).toBe(true);

    const safePipe = await h.emit('tool_call', { toolName: 'bash', toolCallId: 'c4', input: { command: 'git status | head -n 5' } });
    expect(safePipe).toBeUndefined();
  });

  it('preserves user-configured active tools when starting in Agent mode', async () => {
    const h = track(createTestHarness({ initialTools: ['read', 'grep'] }));
    await h.emit('session_start', {});

    expect(h.getActiveTools()).toContain('read');
    expect(h.getActiveTools()).toContain('grep');
    expect(h.getActiveTools()).not.toContain('write');
    expect(h.getActiveTools()).not.toContain('edit');
    expect(h.getActiveTools()).not.toContain('bash');
  });
});

describe('pi-modes read-only shell escape guards', () => {
  it('blocks env command execution, awk system(), and sed -n write flags while allowing safe forms', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    await h.runCommand('ask');

    const envExec = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'e1', input: { command: 'env node -e "console.log(1)"' } })) as { block?: boolean } | undefined;
    expect(envExec?.block).toBe(true);

    const awkSys = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'e2', input: { command: 'awk \'BEGIN { system("id") }\'' } })) as { block?: boolean } | undefined;
    expect(awkSys?.block).toBe(true);

    const sedWrite = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'e3', input: { command: "sed -n '1w /tmp/out.txt' package.json" } })) as { block?: boolean } | undefined;
    expect(sedWrite?.block).toBe(true);

    expect(await h.emit('tool_call', { toolName: 'bash', toolCallId: 'e4', input: { command: 'env' } })).toBeUndefined();
    expect(await h.emit('tool_call', { toolName: 'bash', toolCallId: 'e5', input: { command: "awk '{print $1}' package.json" } })).toBeUndefined();
    expect(await h.emit('tool_call', { toolName: 'bash', toolCallId: 'e6', input: { command: "sed -n '1,5p' package.json" } })).toBeUndefined();
  });
});

describe('pi-modes read-only output-flag and process-substitution guards', () => {
  it('blocks sort -o, find -fprint, git --output, and <(...) process substitution', async () => {
    const h = track(createTestHarness());
    await h.emit('session_start', {});
    await h.runCommand('plan');

    const sortOut = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'f1', input: { command: 'sort -o /tmp/pwn.txt package.json' } })) as { block?: boolean } | undefined;
    expect(sortOut?.block).toBe(true);

    const findWrite = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'f2', input: { command: 'find . -fprint /tmp/pwn.txt' } })) as { block?: boolean } | undefined;
    expect(findWrite?.block).toBe(true);

    const gitOut = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'f3', input: { command: 'git diff --output=/tmp/pwn.txt' } })) as { block?: boolean } | undefined;
    expect(gitOut?.block).toBe(true);

    const procSub = (await h.emit('tool_call', { toolName: 'bash', toolCallId: 'f4', input: { command: 'cat <(node -e "console.log(1)")' } })) as { block?: boolean } | undefined;
    expect(procSub?.block).toBe(true);

    expect(await h.emit('tool_call', { toolName: 'bash', toolCallId: 'f5', input: { command: 'sort package.json' } })).toBeUndefined();
    expect(await h.emit('tool_call', { toolName: 'bash', toolCallId: 'f6', input: { command: 'git diff' } })).toBeUndefined();
  });
});
