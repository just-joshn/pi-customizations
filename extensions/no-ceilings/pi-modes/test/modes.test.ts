import { Key } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { double, type TestHarness, useTestHarness } from './harness.ts';

const ONE = 1;

const ASK_ENTRIES = [{ type: 'custom', customType: 'pi-modes-state', data: { mode: 'ask', toolsBeforeRestricted: ['read', 'bash', 'edit', 'write'] } }];

async function enterReadOnly(mode: 'ask' | 'plan'): Promise<TestHarness> {
  const h = useTestHarness();
  await h.emit('session_start', {});
  await h.runCommand(mode);
  return h;
}

async function bashCall(h: TestHarness, command: string): Promise<unknown> {
  return h.emit('tool_call', { toolName: 'bash', toolCallId: 'bash', input: { command } });
}

describe('pi-modes cycling and guards', () => {
  it('cycles through all 4 modes via Ctrl+Alt+M in exact parity order', async () => {
    const h = useTestHarness();
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

  it('blocks write tools in Ask mode', async () => {
    const h = await enterReadOnly('ask');
    const editBlock = double<{ block?: boolean; reason?: string } | undefined>(await h.emit('tool_call', { toolName: 'edit', toolCallId: 't1', input: { path: 'a.ts' } }));
    expect(editBlock?.block).toBe(true);
    expect(editBlock?.reason).toContain('Ask mode is read-only');
  });

  it('blocks mutating bash commands in Ask mode', async () => {
    const h = await enterReadOnly('ask');
    const rmBlock = double<{ block?: boolean } | undefined>(await bashCall(h, 'rm -rf dist'));
    expect(rmBlock?.block).toBe(true);
  });

  it('allows safe bash commands in Ask mode', async () => {
    const h = await enterReadOnly('ask');
    expect(await bashCall(h, 'git status')).toBeUndefined();
  });

  it('allows mutating bash again after restoring Agent mode', async () => {
    const h = await enterReadOnly('ask');
    await h.runCommand('agent');
    expect(await bashCall(h, 'rm -rf dist')).toBeUndefined();
  });
});

describe('pi-modes flags, switch_mode tool, and persistence', () => {
  it('starts in Plan mode from the --plan flag', async () => {
    const h = useTestHarness({ flags: { plan: true } });
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('Plan');
  });

  it('treats /mode search as the Ask alias', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('mode', 'search');
    expect(h.getStatuses()['pi-modes']).toContain('Ask');
  });

  it('submits an /ask prompt as the user message', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('ask', 'Explain the architecture');
    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('Explain the architecture');
    expect(h.getStatuses()['pi-modes']).toContain('Ask');
  });

  it('toggles Ask mode off when /ask has no prompt', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('ask');
    expect(h.getStatuses()['pi-modes']).toContain('Ask');
    await h.runCommand('ask');
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
  });

  it('rejects an interactive switch_mode request', async () => {
    const interactive = useTestHarness({ selectResponses: ['Reject'] });
    await interactive.emit('session_start', {});
    const rejected = await interactive.callTool('switch_mode', { target_mode_id: 'ask', explanation: 'Read-only Q&A' });
    expect(rejected.details?.['status']).toBe('rejected');
  });

  it('approves an interactive switch_mode request', async () => {
    const interactive = useTestHarness({ selectResponses: ['Approve mode switch'] });
    await interactive.emit('session_start', {});
    const approved = await interactive.callTool('switch_mode', { target_mode_id: 'plan', explanation: 'Plan refactor' });
    expect(approved.details?.['status']).toBe('success');
    expect(interactive.getStatuses()['pi-modes']).toContain('Plan');
  });

  it('auto-approves a read-only switch_mode when there is no UI', async () => {
    const headless = useTestHarness({ hasUI: false });
    await headless.emit('session_start', {});
    const auto = await headless.callTool('switch_mode', { target_mode_id: 'ask' });
    expect(auto.details?.['status']).toBe('success');
    expect(headless.getActiveTools()).not.toContain('write');
  });

  it('rejects a headless escalation from Ask to Agent', async () => {
    const headless = useTestHarness({ hasUI: false });
    await headless.emit('session_start', {});
    await headless.runCommand('ask');
    const rejected = await headless.callTool('switch_mode', { target_mode_id: 'agent' });
    expect(rejected.details?.['status']).toBe('rejected');
    expect(headless.getActiveTools()).not.toContain('edit');
    expect(headless.getActiveTools()).not.toContain('write');
  });

  it('rebuilds the new mode guidance after a switch inside the same run', async () => {
    const h = useTestHarness({ selectResponses: ['Approve mode switch'] });
    await h.emit('session_start', {});
    await h.emit('before_agent_start', { messageType: 'user', prompt: 'start' });
    await h.callTool('switch_mode', { target_mode_id: 'ask' });
    const after = double<{ messages: readonly { content?: string }[] }>(await h.emit('context', { messages: [] }));
    expect(after.messages.map((message) => String(message.content))).toContainEqual(expect.stringContaining('[ASK MODE ACTIVE]'));
  });

  it('keeps the current run guidance and drops stale copies', async () => {
    const h = useTestHarness({ initialEntries: ASK_ENTRIES });
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('Ask');

    const injected = double<{ message?: { content: string; details: { runId: string } } } | undefined>(await h.emit('before_agent_start', { messageType: 'user', prompt: 'hello' }));
    const runId = injected?.message?.details.runId ?? '';
    expect(injected?.message?.content).toContain('[ASK MODE ACTIVE]');

    const filtered = double<{ messages: readonly { content?: string }[] }>(
      await h.emit('context', {
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'custom', customType: 'pi-modes-context', content: '[ASK MODE ACTIVE] current', details: { runId } },
          { role: 'custom', customType: 'pi-modes-context', content: 'stale copy', details: { runId: 'stale-run' } },
        ],
      }),
    );
    expect(filtered.messages.map((message) => message.content)).toEqual(['hello', '[ASK MODE ACTIVE] current']);
  });

  it('preserves user text that quotes a mode banner', async () => {
    const h = useTestHarness({ initialEntries: ASK_ENTRIES });
    await h.emit('session_start', {});
    const injected = double<{ message?: { content: string; details: { runId: string } } } | undefined>(await h.emit('before_agent_start', { messageType: 'user', prompt: 'hello' }));
    const runId = injected?.message?.details.runId ?? '';

    const filtered = double<{ messages: readonly { content?: string }[] }>(
      await h.emit('context', {
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'custom', customType: 'pi-modes-context', content: '[ASK MODE ACTIVE] current', details: { runId } },
          { role: 'user', content: 'What does [PLAN MODE ACTIVE] mean?' },
        ],
      }),
    );
    expect(filtered.messages.map((message) => message.content)).toEqual(['hello', '[ASK MODE ACTIVE] current', 'What does [PLAN MODE ACTIVE] mean?']);
  });
});

describe('pi-modes regression guards', () => {
  it.for(['echo ok && node -e "process.exit(0)"', 'echo $(whoami)', 'find . -name "*.tmp" -delete'])('blocks %s in read-only mode', async (command) => {
    const h = await enterReadOnly('ask');
    const result = double<{ block?: boolean } | undefined>(await bashCall(h, command));
    expect(result?.block).toBe(true);
  });

  it('allows a safe pipe in read-only mode', async () => {
    const h = await enterReadOnly('ask');
    expect(await bashCall(h, 'git status | head -n 5')).toBeUndefined();
  });

  it('preserves user-configured active tools when starting in Agent mode', async () => {
    const h = useTestHarness({ initialTools: ['read', 'grep'] });
    await h.emit('session_start', {});

    expect(h.getActiveTools()).toContain('read');
    expect(h.getActiveTools()).toContain('grep');
    expect(h.getActiveTools()).not.toContain('write');
    expect(h.getActiveTools()).not.toContain('edit');
    expect(h.getActiveTools()).not.toContain('bash');
  });
});

describe('pi-modes read-only shell escape guards', () => {
  it.for([
    'env node -e "console.log(1)"',
    'awk \'BEGIN { system("id") }\'',
    "sed -n '1w /tmp/out.txt' package.json",
    "sed -n -e'1w /tmp/out.txt' package.json",
    'GIT_EXTERNAL_DIFF="touch /tmp/out.txt" git diff',
    'bat --paging=always --pager "touch /tmp/out.txt" package.json',
    'git branch --delete-merged=main',
  ])('blocks %s in read-only mode', async (command) => {
    const h = await enterReadOnly('ask');
    const result = double<{ block?: boolean } | undefined>(await bashCall(h, command));
    expect(result?.block).toBe(true);
  });

  it.for(['env', "awk '{print $1}' package.json", "sed -n '1,5p' package.json", "sed -n -e'1,5p' package.json", 'uniq -f 1 package.json', 'uniq -w 3 package.json', 'git show-ref'])('allows %s in read-only mode', async (command) => {
    const h = await enterReadOnly('ask');
    expect(await bashCall(h, command)).toBeUndefined();
  });
});

describe('pi-modes read-only output-flag and process-substitution guards', () => {
  it.for(['sort -o /tmp/pwn.txt package.json', 'find . -fprint /tmp/pwn.txt', 'git diff --output=/tmp/pwn.txt', 'git diff', 'cat <(node -e "console.log(1)")'])('blocks %s in Plan mode', async (command) => {
    const h = await enterReadOnly('plan');
    const result = double<{ block?: boolean } | undefined>(await bashCall(h, command));
    expect(result?.block).toBe(true);
  });

  it.for(['sort package.json', 'git diff --no-ext-diff --no-textconv'])('allows %s in Plan mode', async (command) => {
    const h = await enterReadOnly('plan');
    expect(await bashCall(h, command)).toBeUndefined();
  });
});

describe('pi-modes read-only tool coverage', () => {
  it('blocks the powershell tool in read-only modes', async () => {
    const h = await enterReadOnly('ask');

    const blocked = double<{ block?: boolean; reason?: string } | undefined>(await h.emit('tool_call', { toolName: 'powershell', toolCallId: 'p1', input: { command: 'Remove-Item -Recurse .' } }));
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain('Ask mode is read-only');
  });

  it('allows the powershell tool in Agent mode', async () => {
    const h = await enterReadOnly('ask');

    await h.runCommand('agent');
    expect(await h.emit('tool_call', { toolName: 'powershell', toolCallId: 'p2', input: { command: 'Get-ChildItem' } })).toBeUndefined();
  });
});

describe('pi-modes read-only shell write forms', () => {
  it.for([
    "printf 'x' 1<> /tmp/pi-modes-out.txt",
    "sed -n 'w/tmp/pi-modes-out.txt' package.json",
    "sed -n '1w /tmp/pi-modes-out.txt' package.json",
    'git remote add evil https://example.com/x.git',
    'git branch newbranch',
    'git branch -D main',
    'sort --out=/tmp/pi-modes-out.txt package.json',
    'bat cache --build --target /tmp/pi-modes-cache',
    'file -C -m /tmp/pi-modes-magic',
  ])('blocks %s in read-only mode', async (command) => {
    const h = await enterReadOnly('ask');
    const result = double<{ block?: boolean } | undefined>(await bashCall(h, command));
    expect(result?.block).toBe(true);
  });

  it.for(["sed -n '1,5p' package.json", 'git branch -a', 'git remote -v', 'git status'])('allows %s in read-only mode', async (command) => {
    const h = await enterReadOnly('ask');
    expect(await bashCall(h, command)).toBeUndefined();
  });
});

describe('pi-modes read-only tool allowlist', () => {
  it('drops write-capable MCP tools from the loadout and blocks their calls', async () => {
    const h = useTestHarness({
      initialTools: ['read', 'bash', 'edit', 'write', 'mcp__filesystem__write_file', 'read_mcp_resource'],
    });
    await h.emit('session_start', {});
    await h.runCommand('ask');

    expect(h.getActiveTools()).not.toContain('mcp__filesystem__write_file');
    expect(h.getActiveTools()).not.toContain('edit');
    expect(h.getActiveTools()).toContain('read_mcp_resource');

    const blocked = double<{ block?: boolean; reason?: string } | undefined>(await h.emit('tool_call', { toolName: 'mcp__filesystem__write_file', toolCallId: 'm1', input: { path: 'a' } }));
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain('Ask mode is read-only');

    const readAllowed = await h.emit('tool_call', { toolName: 'read_mcp_resource', toolCallId: 'm2', input: { server: 's', uri: 'u' } });
    expect(readAllowed).toBeUndefined();

    await h.runCommand('agent');
    expect(h.getActiveTools()).toContain('edit');
    expect(h.getActiveTools()).toContain('mcp__filesystem__write_file');
  });
});

describe('pi-modes read-only loadout enforcement', () => {
  it('drops a late-registered tool during the mode and restores it on the way out', async () => {
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('ask');

    h.setActiveTools([...h.getActiveTools(), 'mcp__docs__write_file']);
    await h.emit('before_agent_start', { messageType: 'user', prompt: 'go' });
    expect(h.getActiveTools()).not.toContain('mcp__docs__write_file');

    h.setActiveTools([...h.getActiveTools(), 'mcp__docs__write_file']);
    await h.emit('mcp_servers_change', { servers: [] });
    expect(h.getActiveTools()).not.toContain('mcp__docs__write_file');

    h.setActiveTools([...h.getActiveTools(), 'mcp__docs__write_file']);
    await h.runCommand('agent');
    expect(h.getActiveTools()).toContain('mcp__docs__write_file');
    expect(h.getActiveTools()).toContain('edit');
  });
});
