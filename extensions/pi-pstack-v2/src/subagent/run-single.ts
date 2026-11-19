import type { AgentConfig } from './agents.ts';
import { getPiInvocation, removePromptTempFile, writePromptToTempFile } from './pi-invocation.ts';
import { createResultStream, finalizeResult } from './result-stream.ts';
import { createUnstartedResult, emptyUsage, getFinalOutput } from './results.ts';
import { runPiInTmux } from './run-in-tmux.ts';
import type { CallModel, DispatchDefaults, MakeDetails, OnUpdateCallback, ResolvedAgent, SingleResult } from './types.ts';

interface AgentRun {
  cwd: string;
  initial: SingleResult;
  args: string[];
  signal: AbortSignal | undefined;
  onUpdate: OnUpdateCallback | undefined;
  makeDetails: MakeDetails;
}

const ABORTED_BEFORE_START = 'Subagent was aborted before starting';

// A model named by the call or the agent runs at its own default thinking level unless the call names one.
function buildPiArgs(agent: AgentConfig, defaults: DispatchDefaults, call: CallModel, promptPath: string | undefined, task: string): string[] {
  const namedModel = call.model ?? agent.model;
  const model = namedModel ?? defaults.model;
  const thinking = call.thinking ?? (namedModel ? undefined : defaults.thinkingLevel);
  return [
    '--mode',
    'json',
    '-p',
    '--no-session',
    ...(model ? ['--model', model] : []),
    ...(thinking ? ['--thinking', thinking] : []),
    ...(agent.tools && agent.tools.length > 0 ? ['--tools', agent.tools.join(',')] : []),
    ...(promptPath ? ['--append-system-prompt', promptPath] : []),
    `Task: ${task}`,
  ];
}

async function streamAgent(run: AgentRun): Promise<SingleResult> {
  const stream = createResultStream(run.initial, (result) => {
    run.onUpdate?.({
      content: [{ type: 'text', text: getFinalOutput(result.messages) || '(running...)' }],
      details: run.makeDetails([result]),
    });
  });
  stream.emit();
  const invocation = getPiInvocation(run.args);
  const outcome = await runPiInTmux({
    command: invocation.command,
    args: invocation.args,
    cwd: run.cwd,
    signal: run.signal,
    onStdoutChunk: stream.onStdoutChunk,
    onStderrChunk: stream.onStderrChunk,
  });
  stream.flush();
  return finalizeResult(stream.result(), outcome, run.signal?.aborted === true);
}

async function runResolvedAgent(
  defaults: DispatchDefaults,
  resolved: ResolvedAgent & { agent: AgentConfig },
  agentName: string,
  task: string,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<SingleResult> {
  const { agent, cwd, call = {} } = resolved;
  const initial: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    status: 'running',
    exitCode: null,
    messages: [],
    stderr: '',
    usage: emptyUsage(),
    model: call.model ?? agent.model ?? defaults.model,
    step,
  };
  let prompt: Awaited<ReturnType<typeof writePromptToTempFile>> | undefined;
  try {
    prompt = agent.systemPrompt.trim() ? await writePromptToTempFile(agent.name, agent.systemPrompt) : undefined;
    if (signal?.aborted) return { ...initial, status: 'aborted', errorMessage: ABORTED_BEFORE_START };
    const args = buildPiArgs(agent, defaults, call, prompt?.filePath, task);
    return await streamAgent({ cwd, initial, args, signal, onUpdate, makeDetails });
  } finally {
    removePromptTempFile(prompt);
  }
}

export async function runSingleAgent(
  defaults: DispatchDefaults,
  resolved: ResolvedAgent,
  agentName: string,
  task: string,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: MakeDetails,
): Promise<SingleResult> {
  if (signal?.aborted) return createUnstartedResult(agentName, task, step, 'aborted', ABORTED_BEFORE_START);
  const { agent } = resolved;
  if (!agent) {
    const available = resolved.available.map((candidate) => `"${candidate.name}"`).join(', ') || 'none';
    return createUnstartedResult(agentName, task, step, 'failed', `Unknown agent: "${agentName}". Available agents: ${available}.`);
  }
  return runResolvedAgent(defaults, { ...resolved, agent }, agentName, task, step, signal, onUpdate, makeDetails);
}
