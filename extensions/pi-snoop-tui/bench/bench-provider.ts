import { appendFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import type { Api, Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { cell } from '../src/cell.ts';
import { type CleanIdleMetrics, cleanIdlePhase, type PhaseMetrics, phase, type Snapshot, snapshot } from './metrics.ts';
import { estimateTokens, replayStream } from './replay.ts';
import { SCRIPT, writeFixtures } from './script.ts';

const IDLE_WINDOW_MS = 10_000;
const DELTA_CHARS = 30;
const DELTA_INTERVAL_MS = 8;
const LOOP_DELAY_RESOLUTION_MS = 10;
const BASE_URL = 'http://127.0.0.1:9';
const BenchEnv = z.object({ SNOOP_BENCH_OUT: z.string().optional() });

export interface RunResult {
  readonly pid: number;
  readonly agentStartEpochMs: number;
  readonly agentEndEpochMs: number;
  readonly idleEndEpochMs: number;
  readonly agentStartHrtimeUs: number;
  readonly agentEndHrtimeUs: number;
  readonly idleEndHrtimeUs: number;
  readonly cleanIdleEndEpochMs: number;
  readonly cleanIdleEndHrtimeUs: number;
  readonly workload: PhaseMetrics;
  readonly idle: PhaseMetrics;
  readonly cleanIdle: CleanIdleMetrics;
  readonly toolResults: number;
  readonly toolErrors: number;
  readonly toolNames: readonly string[];
}
type ToolParameters = Parameters<ExtensionAPI['registerTool']>[0]['parameters'];
const ANY_OBJECT = { type: 'object', properties: {}, additionalProperties: true } as unknown as ToolParameters;
const RENDERERLESS_TOOLS = ['codemode', 'pi_spawn', 'tmux_run'];

function streamReplay(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
  return replayStream(model, context, options, {
    script: SCRIPT,
    deltaChars: DELTA_CHARS,
    deltaIntervalMs: DELTA_INTERVAL_MS,
    leadDelayMs: 0,
    emitEmptyText: true,
    notifyHost: true,
    usage: (_count, turn) => ({ input: 0, output: estimateTokens(turn.text) }),
  });
}

function registerProviders(pi: ExtensionAPI): void {
  for (const name of RENDERERLESS_TOOLS) {
    pi.registerTool({
      name,
      label: name,
      description: `Bench stand-in for ${name}.`,
      parameters: ANY_OBJECT,
      execute: async () => ({ content: [{ type: 'text', text: `${name} is a bench stand-in` }], details: undefined }),
    });
  }
  pi.registerProvider('bench', {
    name: 'Bench replay',
    baseUrl: BASE_URL,
    apiKey: 'bench',
    api: 'bench-replay',
    models: [{ id: 'replay', name: 'Replay', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 32_000 }],
    streamSimple: streamReplay,
  });
}

interface AgentRun {
  readonly outPath: string;
  readonly agentStart: Snapshot;
  readonly agentEnd: Snapshot;
  readonly workload: PhaseMetrics;
  readonly histogram: ReturnType<typeof monitorEventLoopDelay>;
  readonly toolNames: readonly string[];
  readonly toolErrors: number;
  readonly shutdown: () => void;
}

function recordResult(run: AgentRun, idleEnd: Snapshot, idle: PhaseMetrics, idleEndUsage: NodeJS.ResourceUsage): void {
  const cleanIdleEnd = snapshot();
  const result: RunResult = {
    pid: process.pid,
    agentStartEpochMs: run.agentStart.epochMs,
    agentEndEpochMs: run.agentEnd.epochMs,
    idleEndEpochMs: idleEnd.epochMs,
    agentStartHrtimeUs: run.agentStart.hrtimeUs,
    agentEndHrtimeUs: run.agentEnd.hrtimeUs,
    idleEndHrtimeUs: idleEnd.hrtimeUs,
    cleanIdleEndEpochMs: cleanIdleEnd.epochMs,
    cleanIdleEndHrtimeUs: cleanIdleEnd.hrtimeUs,
    workload: run.workload,
    idle,
    cleanIdle: cleanIdlePhase(idleEnd, idleEndUsage, cleanIdleEnd, process.resourceUsage()),
    toolResults: run.toolNames.length,
    toolErrors: run.toolErrors,
    toolNames: run.toolNames,
  };
  appendFileSync(run.outPath, `${JSON.stringify(result)}\n`);
  run.shutdown();
}

function measureIdle(run: AgentRun): void {
  const idleEnd = snapshot();
  const idle = phase(run.agentEnd, idleEnd, run.histogram);
  run.histogram.disable();
  const idleEndUsage = process.resourceUsage();
  setTimeout(() => recordResult(run, idleEnd, idle, idleEndUsage), IDLE_WINDOW_MS);
}

export default function benchProvider(pi: ExtensionAPI): void {
  registerProviders(pi);
  const outPath = BenchEnv.parse(process.env).SNOOP_BENCH_OUT;
  if (!outPath) return;

  const histogram = monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS });
  const toolNames = cell<readonly string[]>([]);
  let toolErrors = 0;
  let start: Snapshot | undefined;
  let finished = false;

  pi.on('session_start', (_event, ctx) => writeFixtures(ctx.cwd));
  pi.on('agent_start', () => {
    if (start) return;
    histogram.enable();
    start = snapshot();
  });
  pi.on('tool_execution_end', (event) => {
    toolNames.write([...toolNames.read(), event.toolName]);
    if (event.isError) toolErrors++;
  });
  pi.on('agent_end', (_event, ctx: ExtensionContext) => {
    if (!start || finished) return;
    finished = true;
    const agentEnd = snapshot();
    const workload = phase(start, agentEnd, histogram);
    histogram.reset();
    const run: AgentRun = { outPath, agentStart: start, agentEnd, workload, histogram, toolNames: toolNames.read(), toolErrors, shutdown: () => ctx.shutdown() };
    setTimeout(() => measureIdle(run), IDLE_WINDOW_MS);
  });
}
