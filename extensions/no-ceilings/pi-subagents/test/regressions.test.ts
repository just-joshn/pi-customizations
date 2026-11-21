import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSessionEvent, ExtensionFactory, Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGate, createTestHarness, delay, double, extractGuardHandler } from './harness.ts';

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
  };
}

vi.mock('@earendil-works/pi-coding-agent', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-coding-agent')>('@earendil-works/pi-coding-agent');

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
    DefaultResourceLoader: MockDefaultResourceLoader,
    createAgentSession: async () => {
      const plan = dequeuePlan();
      capturedFactories = [...capturedFactories, ...lastLoaderFactories];
      return { session: createMockSession(plan) };
    },
  };
});

afterEach(() => {
  plans = [];
  capturedFactories = [];
  lastLoaderFactories = [];
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
      await delay(SHORT_DELAY_MS);
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
      await delay(SHORT_DELAY_MS);

      expect(h.getSentMessages().length).toBe(ONE);
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
      await delay(SHORT_DELAY_MS);
      expect(runningAgentId.length).toBeGreaterThan(ZERO);

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
