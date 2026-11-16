import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import { type Api, type AssistantMessage, type AssistantMessageEventStream, createAssistantMessageEventStream, type Model, type SimpleStreamOptions, type ToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

const IDLE_WINDOW_MS = 10_000;
const DELTA_CHARS = 30;
const DELTA_INTERVAL_MS = 8;

const FIXTURE_FILE = 'fixture.txt';
const EDIT_FILE = 'edit-target.txt';
const EDIT_OLD = 'status: draft';
const EDIT_NEW = 'status: final';

interface Turn {
  readonly text: string;
  readonly toolCalls: readonly Omit<ToolCall, 'type'>[];
}

interface PhaseMetrics {
  readonly wallMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly eldP50Ms: number;
  readonly eldP99Ms: number;
  readonly eldMaxMs: number;
}

interface CleanIdleMetrics {
  readonly wallMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly voluntaryContextSwitches: number;
  readonly involuntaryContextSwitches: number;
}

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

const WORDS = ['render', 'frame', 'buffer', 'stream', 'theme', 'footer', 'header', 'width', 'line', 'cache', 'delta', 'token', 'model', 'tool', 'row', 'panel'];

function sentence(seed: number, length: number): string {
  const words: string[] = [];
  for (let i = 0; i < length; i++) words.push(WORDS[(seed * 7 + i * 3) % WORDS.length] ?? 'row');
  const text = words.join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function markdown(targetChars: number): string {
  const blocks: string[] = [];
  let length = 0;
  for (let section = 0; length < targetChars; section++) {
    const block = [
      `## Section ${section + 1}`,
      '',
      `${sentence(section, 12)} ${sentence(section + 1, 9)} The **${WORDS[section % WORDS.length]}** path stays \`stable\`.`,
      '',
      `- ${sentence(section + 2, 6)}`,
      `- ${sentence(section + 3, 7)}`,
      '',
      '```ts',
      `const width${section} = render(frame, ${section * 8});`,
      '```',
      '',
    ].join('\n');
    blocks.push(block);
    length += block.length;
  }
  return blocks.join('\n').slice(0, targetChars);
}

const BASH_COMMAND = 'i=1; while [ $i -le 3000 ]; do echo "row $i alpha beta gamma delta"; [ $((i % 150)) -eq 0 ] && sleep 0.1; i=$((i+1)); done';

const SCRIPT: readonly Turn[] = [
  {
    text: markdown(3000),
    toolCalls: [
      { id: 'bench-bash', name: 'bash', arguments: { command: BASH_COMMAND } },
      { id: 'bench-read', name: 'read', arguments: { path: FIXTURE_FILE } },
      { id: 'bench-grep', name: 'grep', arguments: { pattern: 'marker', path: FIXTURE_FILE } },
      { id: 'bench-edit', name: 'edit', arguments: { path: EDIT_FILE, edits: [{ oldText: EDIT_OLD, newText: EDIT_NEW }] } },
    ],
  },
  { text: markdown(1500), toolCalls: [] },
];

function writeFixtures(cwd: string): void {
  const lines: string[] = [];
  for (let i = 1; i <= 2000; i++) lines.push(i % 100 === 0 ? `${i} marker line` : `${i} plain fixture line`);
  writeFileSync(join(cwd, FIXTURE_FILE), `${lines.join('\n')}\n`);
  writeFileSync(join(cwd, EDIT_FILE), `title: bench\n${EDIT_OLD}\nowner: snoop\n`);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

function streamReplay(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const lastUser = context.messages.findLastIndex((message) => message.role === 'user');
  const assistantCount = context.messages.slice(lastUser + 1).filter((message) => message.role === 'assistant').length;
  const turn = SCRIPT[Math.min(assistantCount, SCRIPT.length - 1)] ?? { text: '', toolCalls: [] };
  const signal = options?.signal;
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'pending',
    timestamp: Date.now(),
  };

  void (async () => {
    try {
      await options?.onPayload?.({ assistantCount }, model);
      await options?.onResponse?.({ status: 200, headers: {} }, model);
      stream.push({ type: 'start', partial: output });

      const block = { type: 'text' as const, text: '' };
      output.content.push(block);
      const textIndex = output.content.length - 1;
      stream.push({ type: 'text_start', contentIndex: textIndex, partial: output });
      for (let offset = 0; offset < turn.text.length; offset += DELTA_CHARS) {
        await sleep(DELTA_INTERVAL_MS, signal);
        const delta = turn.text.slice(offset, offset + DELTA_CHARS);
        await options?.onProviderStreamEvent?.({ delta }, model);
        block.text += delta;
        stream.push({ type: 'text_delta', contentIndex: textIndex, delta, partial: output });
      }
      stream.push({ type: 'text_end', contentIndex: textIndex, content: block.text, partial: output });

      for (const call of turn.toolCalls) {
        const toolCall: ToolCall = { type: 'toolCall', id: call.id, name: call.name, arguments: {} };
        output.content.push(toolCall);
        const index = output.content.length - 1;
        stream.push({ type: 'toolcall_start', contentIndex: index, partial: output });
        toolCall.arguments = call.arguments;
        stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(call.arguments), partial: output });
        stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial: output });
      }

      const outputTokens = Math.ceil(turn.text.length / 4);
      output.usage.output = outputTokens;
      output.usage.totalTokens = outputTokens;
      output.stopReason = turn.toolCalls.length > 0 ? 'toolUse' : 'stop';
      stream.push({ type: 'done', reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: 'error', reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

interface Snapshot {
  readonly at: number;
  readonly epochMs: number;
  readonly hrtimeUs: number;
  readonly cpu: NodeJS.CpuUsage;
}

function snapshot(): Snapshot {
  return { at: performance.now(), epochMs: performance.timeOrigin + performance.now(), hrtimeUs: Number(process.hrtime.bigint() / 1000n), cpu: process.cpuUsage() };
}

function cleanIdlePhase(from: Snapshot, fromUsage: NodeJS.ResourceUsage, to: Snapshot, toUsage: NodeJS.ResourceUsage): CleanIdleMetrics {
  return {
    wallMs: to.at - from.at,
    cpuUserMs: (to.cpu.user - from.cpu.user) / 1000,
    cpuSystemMs: (to.cpu.system - from.cpu.system) / 1000,
    voluntaryContextSwitches: toUsage.voluntaryContextSwitches - fromUsage.voluntaryContextSwitches,
    involuntaryContextSwitches: toUsage.involuntaryContextSwitches - fromUsage.involuntaryContextSwitches,
  };
}

function phase(from: Snapshot, to: Snapshot, histogram: ReturnType<typeof monitorEventLoopDelay>): PhaseMetrics {
  const ms = (ns: number) => ns / 1e6;
  return {
    wallMs: to.at - from.at,
    cpuUserMs: (to.cpu.user - from.cpu.user) / 1000,
    cpuSystemMs: (to.cpu.system - from.cpu.system) / 1000,
    eldP50Ms: ms(histogram.percentile(50)),
    eldP99Ms: ms(histogram.percentile(99)),
    eldMaxMs: ms(histogram.max),
  };
}

export default function benchProvider(pi: ExtensionAPI): void {
  pi.registerProvider('bench', {
    name: 'Bench replay',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'bench',
    api: 'bench-replay',
    models: [{ id: 'replay', name: 'Replay', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 32_000 }],
    streamSimple: streamReplay,
  });

  const outPath = process.env['SNOOP_BENCH_OUT'];
  if (!outPath) return;

  const histogram = monitorEventLoopDelay({ resolution: 10 });
  const toolNames: string[] = [];
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
    toolNames.push(event.toolName);
    if (event.isError) toolErrors++;
  });

  pi.on('agent_end', (_event, ctx: ExtensionContext) => {
    if (!start || finished) return;
    finished = true;
    const agentStart = start;
    const agentEnd = snapshot();
    const workload = phase(agentStart, agentEnd, histogram);
    histogram.reset();
    setTimeout(() => {
      const idleEnd = snapshot();
      const idle = phase(agentEnd, idleEnd, histogram);
      histogram.disable();
      const idleEndUsage = process.resourceUsage();
      setTimeout(() => {
        const cleanIdleEnd = snapshot();
        const cleanIdle = cleanIdlePhase(idleEnd, idleEndUsage, cleanIdleEnd, process.resourceUsage());
        const result: RunResult = {
          pid: process.pid,
          agentStartEpochMs: agentStart.epochMs,
          agentEndEpochMs: agentEnd.epochMs,
          idleEndEpochMs: idleEnd.epochMs,
          agentStartHrtimeUs: agentStart.hrtimeUs,
          agentEndHrtimeUs: agentEnd.hrtimeUs,
          idleEndHrtimeUs: idleEnd.hrtimeUs,
          cleanIdleEndEpochMs: cleanIdleEnd.epochMs,
          cleanIdleEndHrtimeUs: cleanIdleEnd.hrtimeUs,
          workload,
          idle,
          cleanIdle,
          toolResults: toolNames.length,
          toolErrors,
          toolNames,
        };
        appendFileSync(outPath, `${JSON.stringify(result)}\n`);
        ctx.shutdown();
      }, IDLE_WINDOW_MS);
    }, IDLE_WINDOW_MS);
  });
}
