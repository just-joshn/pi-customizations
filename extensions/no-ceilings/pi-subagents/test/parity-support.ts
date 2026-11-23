import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, vi } from 'vitest';
import { SUBAGENTS_CONFIG_FILE_NAME } from '../src/types.ts';
import type { SubagentsTestHarness } from './harness.ts';

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const THREE = 3;

export interface MockPlan {
  readonly finalText: string;
  readonly events?: readonly AgentSessionEvent[];
  readonly throwError?: string;
  readonly waitForRelease?: Promise<void>;
}

interface CapturedCreate {
  readonly cwd?: string;
  readonly tools?: readonly string[];
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  readonly activeTools: readonly string[];
  readonly childTrust?: boolean;
  readonly loaderTrust?: boolean;
}

type CodingAgentModule = typeof import('@earendil-works/pi-coding-agent');

let plans: readonly MockPlan[] = [];
export let captured: readonly CapturedCreate[] = [];
export let loaderOptions: Readonly<Record<string, unknown>> = {};
let loaderSettingsTrust: boolean | undefined;
export let activeToolsCalls: readonly (readonly string[])[] = [];
let creationGate: Promise<void> | undefined;
export let promptCalls = 0;
export let settledCount = 0;
export let createdSessions: readonly { readonly agent: { readonly state: { model: unknown } } }[] = [];

export function enqueuePlan(plan: MockPlan): void {
  plans = [...plans, plan];
}

function dequeuePlan(): MockPlan {
  const [first, ...rest] = plans;
  plans = rest;
  return first ?? { finalText: 'default response' };
}

export function initRepo(cwd: string): void {
  execFileSync('git', ['init'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  writeFileSync(join(cwd, 'README.md'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['commit', '-m', 'base'], { cwd });
}

export function installSlowGit(bin: string, match: string, flag: string): void {
  mkdirSync(bin, { recursive: true });
  const wrapper = join(bin, 'git');
  writeFileSync(wrapper, ['#!/bin/sh', 'for arg in "$@"; do', `  if [ "$arg" = "${match}" ]; then touch "${flag}"; sleep 2; break; fi`, 'done', 'exec /usr/bin/git "$@"', ''].join('\n'));
  chmodSync(wrapper, 0o755);
}

function isDouble<T>(_value: unknown): _value is T {
  return true;
}

function double<T>(value: unknown): T {
  if (!isDouble<T>(value)) {
    throw new Error('unreachable: test double is always accepted');
  }
  return value;
}

export function latestRunningAgentId(h: SubagentsTestHarness): string | undefined {
  const state = h
    .getEntries()
    .filter((entry) => entry.customType === 'pi-subagents-state')
    .at(-ONE);
  if (state === undefined) {
    return undefined;
  }
  const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly status: string }[] }>(state.data).sessions;
  return sessions.find((session) => session.status === 'running')?.agentId;
}

export function persistedWorktreePath(h: SubagentsTestHarness, agentId: string): string | undefined {
  const state = h
    .getEntries()
    .filter((entry) => entry.customType === 'pi-subagents-state')
    .at(-ONE);
  if (state === undefined) {
    return undefined;
  }
  const sessions = double<{ readonly sessions: readonly { readonly agentId: string; readonly worktree?: { readonly path: string } }[] }>(state.data).sessions;
  return sessions.find((session) => session.agentId === agentId)?.worktree?.path;
}

function createMockSession(plan: MockPlan) {
  let listeners: readonly ((event: AgentSessionEvent) => void)[] = [];
  let aborted = false;
  const prompt = async (): Promise<void> => {
    try {
      promptCalls += 1;
      for (const event of plan.events ?? []) {
        for (const listener of listeners) {
          listener(event);
        }
      }
      if (plan.waitForRelease !== undefined) {
        await plan.waitForRelease;
      }
      if (aborted) {
        throw new Error('aborted');
      }
      if (plan.throwError) {
        throw new Error(plan.throwError);
      }
    } finally {
      settledCount += 1;
    }
  };
  const session = {
    subscribe: (listener: (event: AgentSessionEvent) => void) => {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((entry) => entry !== listener);
      };
    },
    prompt,
    abort: async () => {
      aborted = true;
    },
    dispose: () => undefined,
    getLastAssistantText: () => plan.finalText,
    getCallableToolNames: () => ['read', 'bash', 'edit', 'write'],
    getAllTools: () => [{ name: 'read' }, { name: 'bash' }, { name: 'powershell' }, { name: 'edit' }, { name: 'write' }, { name: 'grep' }, { name: 'find' }, { name: 'ls' }],
    setActiveToolsByName: (names: readonly string[]) => {
      activeToolsCalls = [...activeToolsCalls, names];
    },
    agent: { state: { model: { provider: 'test-provider', id: 'model-sonnet', api: 'anthropic-messages', maxTokens: 8192, contextWindow: 200_000 } } },
  };
  createdSessions = [...createdSessions, session];
  return session;
}

export function createCodingAgentMock(actual: CodingAgentModule): CodingAgentModule {
  class MockDefaultResourceLoader {
    constructor(options: Readonly<Record<string, unknown>>) {
      loaderOptions = options;
      const settingsManager = options['settingsManager'] as { readonly isProjectTrusted?: () => boolean } | undefined;
      loaderSettingsTrust = settingsManager?.isProjectTrusted?.();
    }
    async reload(): Promise<void> {
      return undefined;
    }
  }

  return {
    ...actual,
    DefaultResourceLoader: MockDefaultResourceLoader as unknown as typeof actual.DefaultResourceLoader,
    createAgentSession: (async (options: {
      readonly cwd?: string;
      readonly tools?: readonly string[];
      readonly model?: { readonly id: string };
      readonly thinkingLevel?: string;
      readonly settingsManager?: { readonly isProjectTrusted?: () => boolean };
    }) => {
      captured = [
        ...captured,
        {
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options.tools !== undefined ? { tools: options.tools } : {}),
          ...(options.model !== undefined ? { modelId: options.model.id } : {}),
          ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
          activeTools: [],
          ...(options.settingsManager?.isProjectTrusted !== undefined ? { childTrust: options.settingsManager.isProjectTrusted() } : {}),
          ...(loaderSettingsTrust !== undefined ? { loaderTrust: loaderSettingsTrust } : {}),
        },
      ];
      if (creationGate !== undefined) {
        await creationGate;
      }
      return { session: createMockSession(dequeuePlan()) };
    }) as unknown as typeof actual.createAgentSession,
  };
}

export function writeAgent(cwd: string, relativeDir: string, fileName: string, contents: string): void {
  const dir = join(cwd, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), contents);
}

export function writeConfig(cwd: string, config: unknown): void {
  writeAgent(cwd, '.pi', SUBAGENTS_CONFIG_FILE_NAME, JSON.stringify(config));
}

export function toolEvent(toolName: string, toolCallId: string, args: unknown): readonly AgentSessionEvent[] {
  return [
    double<AgentSessionEvent>({ type: 'tool_execution_start', toolCallId, toolName, args }),
    double<AgentSessionEvent>({ type: 'tool_execution_end', toolCallId, toolName, result: { content: [{ type: 'text', text: `${toolName} output` }] }, isError: false }),
  ];
}

export function clearCaptured(): void {
  captured = [];
}

export function clearActiveToolsCalls(): void {
  activeToolsCalls = [];
}

export function setCreationGate(gate: Promise<void> | undefined): void {
  creationGate = gate;
}

function resetParityState(): void {
  plans = [];
  captured = [];
  loaderOptions = {};
  loaderSettingsTrust = undefined;
  activeToolsCalls = [];
  creationGate = undefined;
  promptCalls = 0;
  settledCount = 0;
  createdSessions = [];
}

export function installParityHooks(): void {
  beforeEach(() => {
    resetParityState();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetParityState();
  });
}
