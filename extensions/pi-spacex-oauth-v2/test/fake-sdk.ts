// A scripted stand-in for @cursor/sdk's Agent, Run, and Cursor namespace. The real error classes stay real.

import type { AgentOptions, RunResult, RunStatus, SDKCustomTool, SDKMessage, SDKModel, SDKUserMessage, SendOptions } from '@cursor/sdk';
import { type Mock, vi } from 'vitest';
import { type Cell, createCell, patchCell } from '../src/cell.ts';
import catalog from './fixtures/cursor-models.json' with { type: 'json' };

export interface RunIO {
  message: string | SDKUserMessage;
  tools: Record<string, SDKCustomTool>;
  emit: (event: SDKMessage) => void;
  /** Resolves when the run is cancelled. */
  cancelled: Promise<void>;
}

export type Script = (io: RunIO) => Promise<Pick<RunResult, 'status'> & Partial<RunResult>>;

type PartialResult = Pick<RunResult, 'status'> & Partial<RunResult>;

const RUN_ID = 'run-1';
const AGENT_ID = 'agent-1';
const THINKING_DURATION_MS = 5;

interface RunState {
  status: RunStatus;
  events: SDKMessage[];
  wakeUp: (() => void) | undefined;
  result: RunResult | undefined;
  failure: unknown;
}

function settleRun(state: Cell<RunState>, result: PartialResult): void {
  if (state.read().result) return;
  patchCell(state, { status: result.status, result: { id: RUN_ID, ...result } });
  state.read().wakeUp?.();
}

function pushEvent(state: Cell<RunState>, event: SDKMessage): void {
  patchCell(state, { events: [...state.read().events, event] });
  state.read().wakeUp?.();
}

async function* streamEvents(state: Cell<RunState>): AsyncGenerator<SDKMessage, void> {
  for (;;) {
    const { events, failure, result } = state.read();
    const [event, ...rest] = events;
    if (event) {
      patchCell(state, { events: rest });
      yield event;
    } else if (failure) throw failure;
    else if (result) return;
    else await new Promise<void>((resolve) => patchCell(state, { wakeUp: resolve }));
  }
}

export interface FakeRun {
  readonly id: string;
  readonly agentId: string;
  readonly status: RunStatus;
  readonly cancel: Mock<() => Promise<void>>;
  stream(): AsyncGenerator<SDKMessage, void>;
  wait(): Promise<RunResult>;
}

export interface FakeAgent {
  readonly agentId: string;
  readonly options: AgentOptions;
  readonly close: Mock<() => void>;
  readonly runs: FakeRun[];
  readonly sends: { message: string | SDKUserMessage; options: SendOptions | undefined }[];
  send(message: string | SDKUserMessage, options?: SendOptions): Promise<FakeRun>;
}

export function createFakeRun(script: Script, message: string | SDKUserMessage, options: SendOptions | undefined): FakeRun {
  const state = createCell<RunState>({ status: 'running', events: [], wakeUp: undefined, result: undefined, failure: undefined });
  let onCancel: () => void = () => undefined;
  const cancelled = new Promise<void>((resolve) => {
    onCancel = resolve;
  });
  const io: RunIO = { message, tools: options?.local?.customTools ?? {}, emit: (event) => pushEvent(state, event), cancelled };
  script(io).then(
    (result) => settleRun(state, result),
    (error: unknown) => {
      patchCell(state, { failure: error });
      settleRun(state, { status: 'error' });
    },
  );
  return {
    id: RUN_ID,
    agentId: AGENT_ID,
    get status() {
      return state.read().status;
    },
    cancel: vi.fn(async () => {
      if (state.read().status !== 'running') return;
      onCancel();
      settleRun(state, { status: 'cancelled' });
    }),
    stream: () => streamEvents(state),
    wait: async (): Promise<RunResult> => state.read().result ?? { id: RUN_ID, status: 'error' },
  };
}

interface SdkState {
  agents: FakeAgent[];
  scripts: Script[];
  sendError: unknown;
  createError: unknown;
}

const initialSdkState = (): SdkState => ({ agents: [], scripts: [], sendError: undefined, createError: undefined });
const sdkState = createCell<SdkState>(initialSdkState());

export function createFakeAgent(options: AgentOptions, index: number): FakeAgent {
  const record = createCell<Pick<FakeAgent, 'runs' | 'sends'>>({ runs: [], sends: [] });
  return {
    agentId: `agent-${index}`,
    options,
    close: vi.fn<() => void>(),
    get runs() {
      return record.read().runs;
    },
    get sends() {
      return record.read().sends;
    },
    async send(message: string | SDKUserMessage, sendOptions?: SendOptions): Promise<FakeRun> {
      patchCell(record, { sends: [...record.read().sends, { message, options: sendOptions }] });
      const [script, ...remaining] = sdkState.read().scripts;
      patchCell(sdkState, { scripts: remaining });
      const { sendError } = sdkState.read();
      if (sendError) throw sendError;
      if (!script) throw new Error('No scripted run left');
      const run = createFakeRun(script, message, sendOptions);
      patchCell(record, { runs: [...record.read().runs, run] });
      return run;
    },
  };
}

export const sdk = {
  get agents() {
    return sdkState.read().agents;
  },
  /** Queues the scripts that the next runs will play, in order. */
  script: (...scripts: Script[]): void => patchCell(sdkState, { scripts: [...sdkState.read().scripts, ...scripts] }),
  failSend: (error: unknown): void => patchCell(sdkState, { sendError: error }),
  failCreate: (error: unknown): void => patchCell(sdkState, { createError: error }),
  reset: (): void => {
    sdkState.write(initialSdkState());
    fakeSdk.Cursor.models.list.mockReset().mockResolvedValue(catalog as SDKModel[]);
    fakeSdk.Cursor.me.mockReset();
    fakeSdk.Cursor.auth.login.mockReset();
    fakeSdk.Agent.create.mockClear();
  },
};

export const fakeSdk = {
  Agent: {
    create: vi.fn(async (options: AgentOptions) => {
      const { createError, agents } = sdkState.read();
      if (createError) throw createError;
      const agent = createFakeAgent(options, agents.length + 1);
      patchCell(sdkState, { agents: [...agents, agent] });
      return agent;
    }),
  },
  Cursor: {
    models: { list: vi.fn(async () => catalog as SDKModel[]) },
    me: vi.fn(),
    auth: { login: vi.fn() },
  },
};

const base = { agent_id: AGENT_ID, run_id: RUN_ID };
export const sdkText = (text: string): SDKMessage => ({ type: 'assistant', ...base, message: { role: 'assistant', content: [{ type: 'text', text }] } });
export const sdkThinking = (text: string, done = false): SDKMessage => ({ type: 'thinking', ...base, text, ...(done ? { thinking_duration_ms: THINKING_DURATION_MS } : {}) });
export const sdkStatus = (): SDKMessage => ({ type: 'status', ...base, status: 'RUNNING' });
