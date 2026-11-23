import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSessionEvent, ExtensionFactory, Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGate, createTestHarness, double, extractGuardHandler } from './harness.ts';

interface MockPlan {
  readonly finalText: string;
  readonly waitForRelease?: Promise<void>;
}

const ZERO = 0;
const ONE = 1;
const SHORT_DELAY_MS = 30;
const LONG_TIMEOUT_MS = 500;
const FAST_ABORT_BUDGET_MS = 100;

let plans: readonly MockPlan[] = [];
let capturedFactories: readonly ExtensionFactory[] = [];
let lastLoaderFactories: readonly ExtensionFactory[] = [];
let sessionToolLists: readonly (readonly string[] | undefined)[] = [];
let sessionFactories: readonly (readonly ExtensionFactory[])[] = [];

function enqueuePlan(plan: MockPlan): void {
  plans = [...plans, plan];
}

function dequeuePlan(): MockPlan {
  const [first, ...rest] = plans;
  plans = rest;
  return first ?? { finalText: 'ok' };
}

function createMockSession(plan: MockPlan) {
  let aborted = false;
  const prompt = async (): Promise<void> => {
    if (plan.waitForRelease !== undefined) {
      await plan.waitForRelease;
    }
    if (aborted) {
      throw new Error('aborted');
    }
  };
  return {
    subscribe: (_fn: (event: AgentSessionEvent) => void) => () => undefined,
    prompt,
    abort: async () => {
      aborted = true;
    },
    dispose: () => undefined,
    getLastAssistantText: () => plan.finalText,
    getCallableToolNames: () => ['read', 'bash', 'edit', 'write'],
    getAllTools: () => [{ name: 'read' }, { name: 'bash' }, { name: 'powershell' }, { name: 'edit' }, { name: 'write' }, { name: 'grep' }, { name: 'find' }, { name: 'ls' }],
    setActiveToolsByName: () => undefined,
    agent: { state: { model: undefined } },
  };
}

vi.mock(import('@earendil-works/pi-coding-agent'), async (importOriginal) => {
  const actual = await importOriginal();

  class MockDefaultResourceLoader {
    constructor(opts: { readonly extensionFactories?: readonly ExtensionFactory[] }) {
      lastLoaderFactories = opts.extensionFactories ?? [];
    }
    async reload(): Promise<void> {
      return undefined;
    }
  }

  return {
    ...actual,
    DefaultResourceLoader: MockDefaultResourceLoader as typeof actual.DefaultResourceLoader,
    createAgentSession: (async (opts: { readonly tools?: readonly string[] }) => {
      const plan = dequeuePlan();
      sessionToolLists = [...sessionToolLists, opts.tools];
      sessionFactories = [...sessionFactories, lastLoaderFactories];
      capturedFactories = [...capturedFactories, ...lastLoaderFactories];
      return { session: createMockSession(plan) };
    }) as unknown as typeof actual.createAgentSession,
  };
});

afterEach(() => {
  plans = [];
  capturedFactories = [];
  lastLoaderFactories = [];
  sessionToolLists = [];
  sessionFactories = [];
});

async function evaluateReadonlyBashMatrix(blocked: readonly string[], allowed: readonly string[]): Promise<{ readonly blockedFailures: readonly string[]; readonly allowedFailures: readonly string[] }> {
  const h = createTestHarness();
  try {
    await h.emit('session_start', {});
    enqueuePlan({ finalText: 'done' });
    await h.callTool('task', { description: 'Explore', prompt: 'Check', subagent_type: 'explore' });
    const guard = extractGuardHandler(capturedFactories[ZERO]);
    if (!guard) {
      throw new Error('readonly guard handler missing');
    }
    let blockedFailures: readonly string[] = [];
    for (const command of blocked) {
      const decision = await guard({ toolName: 'bash', input: { command } });
      if (decision?.block !== true) {
        blockedFailures = [...blockedFailures, command];
      }
    }
    let allowedFailures: readonly string[] = [];
    for (const command of allowed) {
      const decision = await guard({ toolName: 'bash', input: { command } });
      if (decision !== undefined) {
        allowedFailures = [...allowedFailures, command];
      }
    }
    return { blockedFailures, allowedFailures };
  } finally {
    await h.cleanup();
  }
}

describe('Finding 1: malformed YAML does not crash discovery', () => {
  it('skips malformed agent files while loading valid custom and built-in subagents', async () => {
    const h = createTestHarness();
    try {
      const agentsDir = join(h.cwd, '.pi', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'good.md'), '---\nname: good-agent\ndescription: Valid\n---\nDo good work.');
      writeFileSync(join(agentsDir, 'broken.md'), '---\nname: [unclosed\n---\nBroken body.');

      await expect(h.emit('session_start', {})).resolves.toBeUndefined();
      await h.runCommand('agents');
      const output = h.getNotifications().at(-ONE)?.message ?? '';
      expect(output).toContain('good-agent');
      expect(output).toContain('general-purpose');
      expect(output).not.toContain('broken');
    } finally {
      await h.cleanup();
    }
  });
});

describe('Finding 2: plain markdown without frontmatter is ignored', () => {
  it('does not register README.md without frontmatter as a subagent', async () => {
    const h = createTestHarness();
    try {
      const agentsDir = join(h.cwd, '.pi', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'README.md'), '# Agents directory\nDocs only.');

      await h.emit('session_start', {});
      await h.runCommand('agents');
      const output = h.getNotifications().at(-ONE)?.message ?? '';
      expect(output).not.toContain('README');
      expect(output).toContain('general-purpose');
    } finally {
      await h.cleanup();
    }
  });
});

describe('Finding 3: readonly shell guard blocks bypass vectors', () => {
  it('blocks newline injection, env exec, find -delete/-exec, and awk system()', async () => {
    const result = await evaluateReadonlyBashMatrix(
      ['ls -la\npython3 -c "import os"', 'env python3 -c "import os"', 'find . -delete', 'find . -exec python3 -c "print(1)" +', 'awk \'BEGIN { system("python3 -c 1") }\''],
      ['find . -maxdepth 2 -name "*.ts"', 'env'],
    );
    expect(result).toEqual({ blockedFailures: [], allowedFailures: [] });
  });
});

describe('Finding 4: lazy discovery before session_start', () => {
  it('resolves built-in subagents for task and /agents even before session_start fires', async () => {
    const h = createTestHarness();
    try {
      await h.runCommand('agents');
      expect(h.getNotifications().at(-ONE)?.message).toContain('general-purpose');

      enqueuePlan({ finalText: 'Early result.' });
      const res = await h.callTool('task', { description: 'Early task', prompt: 'Run before session_start' });
      expect(res.details?.status).toBe('success');
      expect(res.details?.finalMessage).toBe('Early result.');
    } finally {
      await h.cleanup();
    }
  });
});

describe('Finding 5: await-background resume on background-by-default subagent', () => {
  it('awaits a running background-by-default subagent when resume has empty prompt and readonly true', async () => {
    const h = createTestHarness();
    try {
      const agentsDir = join(h.cwd, '.pi', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'bg-worker.md'), '---\nname: bg-worker\nbackground: true\n---\nWork in background.');
      await h.emit('session_start', {});

      const gate = createGate();
      enqueuePlan({ finalText: 'BG worker done.', waitForRelease: gate.promise });
      const started = await h.callTool('task', { description: 'Start bg worker', prompt: 'Process items', subagent_type: 'bg-worker' });
      const agentId = started.details?.agentId ?? '';
      expect(started.details?.isBackground).toBe(true);

      const awaitPromise = h.callTool('task', { description: 'Await bg worker', prompt: '', subagent_type: 'bg-worker', readonly: true, resume: agentId });
      gate.release();
      const awaited = await awaitPromise;
      expect(awaited.details?.status).toBe('success');
      expect(awaited.details?.finalMessage).toBe('BG worker done.');
    } finally {
      await h.cleanup();
    }
  });
});

describe('Finding 6: abortRun waits for settlement or marks session cancelled immediately', () => {
  it('does not report a freshly aborted running subagent as complete with status running', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'never', waitForRelease: gate.promise });

      const bg = await h.callTool('task', { description: 'Slow bg task', prompt: 'Hang', run_in_background: true });
      const agentId = bg.details?.agentId ?? '';

      await h.runCommand('tasks', `abort ${agentId}`);
      const awaitPromise = h.callTool('await_subagent', { agent_id: agentId, timeout_ms: LONG_TIMEOUT_MS });
      gate.release();
      const res = await awaitPromise;
      expect(res.details?.status).not.toBe('running');
      const details = double<{ readonly outcome?: string; readonly finalMessage?: string; readonly error?: string } | undefined>(res.details);
      expect(details?.outcome).toBe('complete');
      await h.runCommand('tasks', 'list');
      expect(h.getNotifications().at(-ONE)?.message).toContain('[cancelled/bg]');
    } finally {
      await h.cleanup();
    }
  });
});

describe('Finding 7: pre-aborted AbortSignal cancels immediately', () => {
  it('fails await_subagent immediately when signal is already aborted', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'slow', waitForRelease: gate.promise });

      const bg = await h.callTool('task', { description: 'BG work', prompt: 'Wait', run_in_background: true });
      const agentId = bg.details?.agentId ?? '';

      const ac = new AbortController();
      ac.abort();
      const t0 = Date.now();
      const res = await h.callTool('await_subagent', { agent_id: agentId, timeout_ms: LONG_TIMEOUT_MS }, { signal: ac.signal });
      const elapsed = Date.now() - t0;
      const details = double<{ readonly outcome?: string } | undefined>(res.details);
      expect(details?.outcome).toBe('error');
      expect(elapsed).toBeLessThan(FAST_ABORT_BUDGET_MS);
      gate.release();
    } finally {
      await h.cleanup();
    }
  });

  it('cancels foreground task immediately when signal is already aborted', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'should not complete as success' });
      const ac = new AbortController();
      ac.abort();

      const res = await h.callTool('task', { description: 'Pre-aborted fg', prompt: 'Do work' }, { signal: ac.signal });
      expect(res.details?.status).toBe('cancelled');
    } finally {
      await h.cleanup();
    }
  });
});

const DIR_NO_ACCESS = 0o000;
const DIR_READ_WRITE_EXEC = 0o755;

describe('Round 2 Finding 1: resumed background run clears prior wakeup suppression', () => {
  it('delivers completion wakeup when a previously awaited agentId is resumed in background', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate1 = createGate();
      enqueuePlan({ finalText: 'Run 1 done.', waitForRelease: gate1.promise });

      const bg1 = await h.callTool('task', { description: 'BG run 1', prompt: 'First pass', run_in_background: true });
      const agentId = bg1.details?.agentId ?? '';

      const await1 = h.callTool('await_subagent', { agent_id: agentId, timeout_ms: LONG_TIMEOUT_MS });
      gate1.release();
      await await1;
      expect(h.getSentMessages().length).toBe(ZERO);

      const gate2 = createGate();
      enqueuePlan({ finalText: 'Run 2 done.', waitForRelease: gate2.promise });
      await h.callTool('task', { description: 'BG run 2', prompt: 'Second pass', resume: agentId, run_in_background: true });
      gate2.release();
      await expect.poll(() => h.getSentMessages().length).toBe(ONE);
    } finally {
      await h.cleanup();
    }
  });
});

describe('Round 2 Finding 2: readonly shell guard blocks output flags and process substitution', () => {
  it('blocks sort -o, git --output, sed w flag, and <(...) process substitution', async () => {
    const result = await evaluateReadonlyBashMatrix(
      ['sort -o /tmp/pwned /etc/hosts', 'git diff --output=/tmp/pwned', 'git log --output=/tmp/pwned', 'sed -e "s/a/b/w /tmp/pwned" /etc/hosts', 'diff <(python3 -c "print(1)") <(echo 1)'],
      ['sort /etc/hosts', 'git diff --stat'],
    );
    expect(result).toEqual({ blockedFailures: [], allowedFailures: [] });
  });
});

describe('Round 2 Finding 3: unreadable agents directory does not crash discovery', () => {
  it('skips an EACCES agents directory and still loads built-in subagents', async () => {
    const h = createTestHarness();
    const agentsDir = join(h.cwd, '.pi', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    chmodSync(agentsDir, DIR_NO_ACCESS);
    try {
      await expect(h.emit('session_start', {})).resolves.toBeUndefined();
      await h.runCommand('agents');
      expect(h.getNotifications().at(-ONE)?.message).toContain('general-purpose');
    } finally {
      chmodSync(agentsDir, DIR_READ_WRITE_EXEC);
      await h.cleanup();
    }
  });
});

describe('Round 2 Finding 4: resuming an active foreground subagent is rejected as busy', () => {
  it('throws busy error when resuming a subagent currently running in foreground', async () => {
    const h = createTestHarness();
    try {
      await h.emit('session_start', {});
      const gate = createGate();
      enqueuePlan({ finalText: 'FG finished.', waitForRelease: gate.promise });

      let runningAgentId = '';
      const onUpdate = (partial: { readonly details?: { readonly agentId?: string } }): void => {
        runningAgentId = partial.details?.agentId ?? runningAgentId;
      };
      const fgPromise = h.callTool('task', { description: 'Active fg task', prompt: 'Run long work' }, { onUpdate });
      await expect.poll(() => runningAgentId.length).toBeGreaterThan(ZERO);

      await expect(h.callTool('task', { description: 'Concurrent resume', prompt: 'Steal session', resume: runningAgentId })).rejects.toThrow('Sub-agent is currently running');

      gate.release();
      await fgPromise;
    } finally {
      await h.cleanup();
    }
  });
});

const NARROW_WIDTH = 12;
const TRANSCRIPT_WIDTH = 24;

function createAnsiTheme(): Theme {
  return double<Theme>({
    fg: (_token: string, text: string) => `\x1b[2m${text}\x1b[22m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    strikethrough: (text: string) => text,
  });
}

function captureOverlayViews(ansiTheme: Theme, onCapture: (emptyLines: readonly string[], activeLines: readonly string[], transcriptLines: readonly string[]) => void) {
  let capturedEmpty: readonly string[] = [];
  return async (
    factory: (tui: { readonly requestRender: () => void }, theme: Theme, kb: unknown, done: (val: unknown) => void) => { readonly render: (w: number) => string[]; readonly handleInput?: (d: string) => void; readonly dispose?: () => void },
  ): Promise<void> => {
    const comp = factory({ requestRender: () => undefined }, ansiTheme, {}, () => undefined);
    const raw = comp.render(NARROW_WIDTH);
    if (capturedEmpty.length === ZERO) {
      capturedEmpty = raw;
      onCapture(capturedEmpty, [], []);
    } else {
      comp.handleInput?.('\r');
      onCapture(capturedEmpty, raw, comp.render(TRANSCRIPT_WIDTH));
    }
    comp.dispose?.();
  };
}

describe('Round 3 Finding 1: tasks overlay respects visibleWidth <= width', () => {
  it('never returns a line wider than width in list or transcript view', async () => {
    let emptyListLines: readonly string[] = [];
    let activeListLines: readonly string[] = [];
    let transcriptLines: readonly string[] = [];
    const onCustomOverlay = captureOverlayViews(createAnsiTheme(), (empty, active, transcript) => {
      emptyListLines = empty;
      activeListLines = active;
      transcriptLines = transcript;
    });
    const h = createTestHarness({ onCustomOverlay });
    try {
      await h.emit('session_start', {});
      await h.runCommand('tasks');
      for (const line of emptyListLines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(NARROW_WIDTH);
      }

      const gate = createGate();
      enqueuePlan({ finalText: 'done', waitForRelease: gate.promise });
      await h.callTool('task', {
        description: 'Very long description exceeding narrow terminal widths',
        prompt: 'A very long prompt line that definitely exceeds narrow terminal widths easily',
        run_in_background: true,
      });
      await h.runCommand('tasks');
      for (const line of activeListLines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(NARROW_WIDTH);
      }
      for (const line of transcriptLines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(TRANSCRIPT_WIDTH);
      }
      gate.release();
    } finally {
      await h.cleanup();
    }
  });
});

describe('Round 3 Finding 2: readonly shell guard blocks fd/rg/sed/awk exec and write flags', () => {
  it('blocks sed w/e, fd -x/--exec, rg --pre, and awk -i inplace while allowing safe forms', async () => {
    const result = await evaluateReadonlyBashMatrix(
      ['sed "w pwned.txt" /etc/hosts', 'sed "s/a/b/e" /etc/hosts', 'fd . -x python3 -c "print(1)"', 'fd . --exec python3 -c "print(1)"', 'rg --pre python3 foo .', 'awk -i inplace "{print}" /etc/hosts'],
      ["sed -n '1,5p' /etc/hosts", 'fd -e ts', 'rg foo .', "awk '{print $1}' /etc/hosts"],
    );
    expect(result).toEqual({ blockedFailures: [], allowedFailures: [] });
  });
});

describe('Round 4 Finding 1: readonly shell guard blocks yq in-place and addressed sed write', () => {
  it('blocks yq -i/--inplace and addressed sed w while allowing read-only yq', async () => {
    const result = await evaluateReadonlyBashMatrix(['yq -i ".a = 1" config.yaml', 'yq --inplace ".a = 1" config.yaml', "sed '1w out.txt' /etc/hosts"], ["yq '.a' config.yaml"]);
    expect(result).toEqual({ blockedFailures: [], allowedFailures: [] });
  });
});

const TEST_PROVIDER_URL = 'https://example.test';

describe('Inherited extension providers in child subagent sessions', () => {
  it('forwards parent native and config providers into child extensionFactories when noExtensions is true', async () => {
    const nativeProvider = { id: 'google-oauth-v2', name: 'Google OAuth v2' };
    const configProvider = { baseUrl: TEST_PROVIDER_URL, apiKey: 'oauth-token' };
    const h = createTestHarness({
      registeredNativeProviders: { 'google-oauth-v2': nativeProvider },
      registeredProviderConfigs: { 'custom-anthropic': configProvider },
    });
    try {
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'Subagent succeeded with OAuth provider.' });
      await h.callTool('task', { description: 'OAuth child', prompt: 'Hello' });

      let registered: readonly { readonly name?: string; readonly value: unknown }[] = [];
      const onRegister = (first: unknown, second?: unknown): void => {
        registered = [...registered, second === undefined ? { value: first } : { name: String(first), value: second }];
      };
      const fakeChildPi = double<{ readonly on: () => void; readonly registerProvider: typeof onRegister }>({ on: () => undefined, registerProvider: onRegister });
      for (const factory of capturedFactories) {
        void factory(double(fakeChildPi));
      }

      expect(registered).toContainEqual({ value: nativeProvider });
      expect(registered).toContainEqual({ name: 'custom-anthropic', value: configProvider });
    } finally {
      await h.cleanup();
    }
  });
});

describe('Nested task + await for opted-in non-readonly subagents', () => {
  interface FakeTool {
    readonly name: string;
    readonly execute: (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: unknown) => Promise<{ readonly details: { readonly agentId: string; readonly outcome?: string } }>;
  }

  function writeAgent(cwd: string, name: string, frontmatter: string): void {
    const dir = join(cwd, '.pi', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: test\n${frontmatter}\n---\nPrompt for ${name}`);
  }

  function installNested(factories: readonly ExtensionFactory[]): readonly FakeTool[] {
    let tools: readonly FakeTool[] = [];
    const fakePi = double<{ readonly on: () => void; readonly registerProvider: () => void; readonly registerTool: (tool: FakeTool) => void }>({
      on: () => undefined,
      registerProvider: () => undefined,
      registerTool: (tool: FakeTool) => {
        tools = [...tools, tool];
      },
    });
    for (const factory of factories) {
      void factory(double(fakePi));
    }
    return tools;
  }

  it('gives task and await_subagent only to opted-in, non-readonly children', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, 'pr-owner', 'nested-tasks: true\ntools: read, bash');
      writeAgent(h.cwd, 'plain', 'tools: read');
      writeAgent(h.cwd, 'ro-owner', 'nested-tasks: true\nreadonly: true');
      await h.emit('session_start', {});
      for (const type of ['pr-owner', 'plain', 'ro-owner']) {
        enqueuePlan({ finalText: type });
        await h.callTool('task', { description: type, prompt: 'go', subagent_type: type });
      }
      const names = sessionFactories.map((f) => installNested(f).map((t) => t.name));
      expect(names).toEqual([['task', 'await_subagent'], [], []]);
      expect(sessionToolLists[ZERO]).toEqual(['read', 'bash', 'task', 'await_subagent']);
      expect(sessionToolLists[ONE]).toEqual(['read']);
    } finally {
      await h.cleanup();
    }
  });

  it('allows exactly one extra level and keeps await inside the launching scope', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, 'pr-owner', 'nested-tasks: true');
      writeAgent(h.cwd, 'grand', 'nested-tasks: true');
      await h.emit('session_start', {});
      enqueuePlan({ finalText: 'owner' });
      await h.callTool('task', { description: 'owner', prompt: 'go', subagent_type: 'pr-owner' });
      const [taskTool, awaitTool] = installNested(sessionFactories[ZERO] ?? []);
      expect(taskTool?.name).toBe('task');
      enqueuePlan({ finalText: 'grandchild done' });
      const grand = await taskTool?.execute('c1', { description: 'grand', prompt: 'x', subagent_type: 'grand' }, undefined, undefined, h.ctx);
      expect(sessionFactories).toHaveLength(2);
      expect(installNested(sessionFactories[ONE] ?? [])).toEqual([]);
      expect(sessionToolLists[ONE]).toBeUndefined();
      expect(grand?.details.agentId).toMatch(/^[0-9a-f-]{36}$/i);
      const foreign = await awaitTool?.execute('c2', { agent_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }, undefined, undefined, h.ctx);
      expect(foreign?.details.outcome).toBe('not_found');
      await expect(taskTool?.execute('c3', { description: 'r', prompt: 'x', resume: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }, undefined, undefined, h.ctx)).rejects.toThrow(/not launched by this agent/);
    } finally {
      await h.cleanup();
    }
  });

  it('aborts nested background runs when the owning child ends, without parent wakeups', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, 'pr-owner', 'nested-tasks: true');
      await h.emit('session_start', {});
      const ownerGate = createGate();
      const grandGate = createGate();
      enqueuePlan({ finalText: 'owner', waitForRelease: ownerGate.promise });
      await h.callTool('task', { description: 'owner', prompt: 'go', subagent_type: 'pr-owner', run_in_background: true });
      const [taskTool, awaitTool] = installNested(sessionFactories[ZERO] ?? []);
      enqueuePlan({ finalText: 'late', waitForRelease: grandGate.promise });
      const launched = await taskTool?.execute('c1', { description: 'bg', prompt: 'x', run_in_background: true }, undefined, undefined, h.ctx);
      const grandId = launched?.details.agentId ?? '';
      const waiting = await awaitTool?.execute('c2', { agent_id: grandId, timeout_ms: SHORT_DELAY_MS }, undefined, undefined, h.ctx);
      expect(waiting?.details.outcome).toBe('still_running');
      ownerGate.release();
      await expect
        .poll(() => {
          const states = h.getEntries().filter((e) => e.customType === 'pi-subagents-state');
          const lastState = double<{ readonly sessions: readonly { readonly agentId: string; readonly status: string }[] }>(states.at(-ONE)?.data);
          return lastState.sessions.find((x) => x.agentId === grandId)?.status;
        })
        .toBe('cancelled');
      grandGate.release();
      await expect
        .poll(() =>
          h.getSentMessages().some((m) => {
            const text = JSON.stringify(m);
            return text.includes('owner') || text.includes('Background Subagent');
          }),
        )
        .toBe(true);
      const states = h.getEntries().filter((e) => e.customType === 'pi-subagents-state');
      const lastState = double<{ readonly sessions: readonly { readonly agentId: string; readonly status: string }[] }>(states.at(-ONE)?.data);
      expect(lastState.sessions.find((x) => x.agentId === grandId)?.status).toBe('cancelled');
      const wakeups = h.getSentMessages().map((m) => JSON.stringify(m));
      expect(wakeups.filter((m) => m.includes('owner') || m.includes('Background Subagent'))).not.toHaveLength(ZERO);
      expect(wakeups.some((m) => m.includes(grandId))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  it('lets a resumed owner resume its own child while still rejecting foreign children', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, 'pr-owner', 'nested-tasks: true');
      await h.emit('session_start', {});

      enqueuePlan({ finalText: 'foreign done' });
      const foreign = await h.callTool('task', { description: 'foreign', prompt: 'root child' });
      const foreignId = foreign.details?.agentId ?? '';

      const ownerGate = createGate();
      enqueuePlan({ finalText: 'owner pass 1', waitForRelease: ownerGate.promise });
      const owner = await h.callTool('task', { description: 'owner', prompt: 'first', subagent_type: 'pr-owner', run_in_background: true });
      const ownerId = owner.details?.agentId ?? '';
      const [task1] = installNested(sessionFactories[ONE] ?? []);

      enqueuePlan({ finalText: 'child pass 1' });
      const child = await task1?.execute('n1', { description: 'child', prompt: 'first' }, undefined, undefined, h.ctx);
      const childId = child?.details.agentId ?? '';

      ownerGate.release();
      await h.callTool('await_subagent', { agent_id: ownerId, timeout_ms: LONG_TIMEOUT_MS });

      enqueuePlan({ finalText: 'owner pass 2' });
      await h.callTool('task', { description: 'owner', prompt: 'continue', subagent_type: 'pr-owner', resume: ownerId });
      const [task2, await2] = installNested(sessionFactories.at(-ONE) ?? []);

      enqueuePlan({ finalText: 'child pass 2' });
      const resumedChild = await task2?.execute('n2', { description: 'child', prompt: 'continue', resume: childId }, undefined, undefined, h.ctx);
      expect(resumedChild?.details.agentId).toBe(childId);
      const awaitedChild = await await2?.execute('n3', { agent_id: childId }, undefined, undefined, h.ctx);
      expect(awaitedChild?.details.outcome).toBe('complete');

      await expect(task2?.execute('n4', { description: 'steal', prompt: 'nope', resume: foreignId }, undefined, undefined, h.ctx)).rejects.toThrow(/not launched by this agent/);
    } finally {
      await h.cleanup();
    }
  });

  it('preserves root lineage without granting nested tools when a depth-2 grandchild launched by a real child session is resumed from root', async () => {
    const h = createTestHarness();
    try {
      writeAgent(h.cwd, 'pr-owner', 'nested-tasks: true');
      writeAgent(h.cwd, 'grand', 'nested-tasks: true');
      await h.emit('session_start', {});

      enqueuePlan({ finalText: 'owner' });
      await h.callTool('task', { description: 'owner', prompt: 'go', subagent_type: 'pr-owner' });
      const [taskTool] = installNested(sessionFactories[ZERO] ?? []);

      const childCtx = double<typeof h.ctx>({
        ...h.ctx,
        sessionManager: {
          ...h.ctx.sessionManager,
          getSessionId: () => '22222222-3333-4444-8555-666666666666',
        },
      });

      enqueuePlan({ finalText: 'grand pass 1' });
      const grand = await taskTool?.execute('g1', { description: 'grand', prompt: 'go', subagent_type: 'grand' }, undefined, undefined, childCtx);
      const grandId = grand?.details.agentId ?? '';
      expect(installNested(sessionFactories[ONE] ?? [])).toEqual([]);

      enqueuePlan({ finalText: 'grand pass 2' });
      const resumed = await h.callTool('task', { description: 'resume grand', prompt: 'again', subagent_type: 'grand', resume: grandId });
      expect(resumed.details?.agentId).toBe(grandId);
      expect(installNested(sessionFactories.at(-ONE) ?? [])).toEqual([]);
    } finally {
      await h.cleanup();
    }
  });
});
