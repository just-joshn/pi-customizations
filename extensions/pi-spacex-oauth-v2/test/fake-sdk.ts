// A scripted stand-in for @cursor/sdk's Agent, Run, and Cursor namespace. The real error classes stay real.

import type { AgentOptions, RunResult, RunStatus, SDKCustomTool, SDKMessage, SDKModel, SDKUserMessage, SendOptions } from '@cursor/sdk';
import { vi } from 'vitest';
import catalog from './fixtures/cursor-models.json' with { type: 'json' };

export interface RunIO {
  message: string | SDKUserMessage;
  tools: Record<string, SDKCustomTool>;
  emit: (event: SDKMessage) => void;
  /** Resolves when the run is cancelled. */
  cancelled: Promise<void>;
}

export type Script = (io: RunIO) => Promise<Pick<RunResult, 'status'> & Partial<RunResult>>;

export class FakeRun {
  status: RunStatus = 'running';
  readonly id = 'run-1';
  readonly agentId = 'agent-1';
  readonly cancel = vi.fn(async () => {
    if (this.status !== 'running') return;
    this.onCancel();
    this.settle({ status: 'cancelled' });
  });
  private events: SDKMessage[] = [];
  private wakeUp: (() => void) | undefined;
  private result: RunResult | undefined;
  private failure: unknown;
  private onCancel: () => void = () => {};

  constructor(script: Script, message: string | SDKUserMessage, options: SendOptions | undefined) {
    const cancelled = new Promise<void>((resolve) => {
      this.onCancel = resolve;
    });
    const io: RunIO = { message, tools: options?.local?.customTools ?? {}, emit: (event) => this.push(event), cancelled };
    script(io).then(
      (result) => this.settle(result),
      (error: unknown) => {
        this.failure = error;
        this.settle({ status: 'error' });
      },
    );
  }

  async *stream(): AsyncGenerator<SDKMessage, void> {
    for (;;) {
      const event = this.events.shift();
      if (event) yield event;
      else if (this.failure) throw this.failure;
      else if (this.result) return;
      else await new Promise<void>((resolve) => (this.wakeUp = resolve));
    }
  }

  async wait(): Promise<RunResult> {
    return this.result ?? { id: this.id, status: 'error' };
  }

  private push(event: SDKMessage): void {
    this.events.push(event);
    this.wakeUp?.();
  }

  private settle(result: Pick<RunResult, 'status'> & Partial<RunResult>): void {
    if (this.result) return;
    this.status = result.status;
    this.result = { id: this.id, ...result };
    this.wakeUp?.();
  }
}

export class FakeAgent {
  readonly agentId: string;
  readonly runs: FakeRun[] = [];
  readonly sends: { message: string | SDKUserMessage; options: SendOptions | undefined }[] = [];
  readonly close = vi.fn();
  readonly options: AgentOptions;

  constructor(options: AgentOptions, index: number) {
    this.options = options;
    this.agentId = `agent-${index}`;
  }

  async send(message: string | SDKUserMessage, options?: SendOptions): Promise<FakeRun> {
    this.sends.push({ message, options });
    const script = sdk.scripts.shift();
    if (sdk.sendError) throw sdk.sendError;
    if (!script) throw new Error('No scripted run left');
    const run = new FakeRun(script, message, options);
    this.runs.push(run);
    return run;
  }
}

export const sdk = {
  agents: [] as FakeAgent[],
  scripts: [] as Script[],
  sendError: undefined as unknown,
  createError: undefined as unknown,
  reset() {
    this.agents = [];
    this.scripts = [];
    this.sendError = undefined;
    this.createError = undefined;
    fakeSdk.Cursor.models.list.mockReset().mockResolvedValue(catalog as SDKModel[]);
    fakeSdk.Cursor.me.mockReset();
    fakeSdk.Cursor.auth.login.mockReset();
    fakeSdk.Agent.create.mockClear();
  },
};

export const fakeSdk = {
  Agent: {
    create: vi.fn(async (options: AgentOptions) => {
      if (sdk.createError) throw sdk.createError;
      const agent = new FakeAgent(options, sdk.agents.length + 1);
      sdk.agents.push(agent);
      return agent;
    }),
  },
  Cursor: {
    models: { list: vi.fn(async () => catalog as SDKModel[]) },
    me: vi.fn(),
    auth: { login: vi.fn() },
  },
};

const base = { agent_id: 'agent-1', run_id: 'run-1' };
export const sdkText = (text: string): SDKMessage => ({ type: 'assistant', ...base, message: { role: 'assistant', content: [{ type: 'text', text }] } });
export const sdkThinking = (text: string, done = false): SDKMessage => ({ type: 'thinking', ...base, text, ...(done ? { thinking_duration_ms: 5 } : {}) });
export const sdkStatus = (): SDKMessage => ({ type: 'status', ...base, status: 'RUNNING' });
