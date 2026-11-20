import type { AgentConfig } from './agents.ts';
import { getPiInvocation, removePromptTempFile, writePromptToTempFile } from './pi-invocation.ts';
import { createResultStream, finalizeResult } from './result-stream.ts';
import { createUnstartedResult, emptyUsage, getFinalOutput } from './results.ts';
import { runPiInTmux } from './run-in-tmux.ts';
import { withPreloadedSkills } from './skill-preload.ts';
import type { CallModel, DispatchDefaults, MakeDetails, OnUpdateCallback, ResolvedAgent, SingleResult } from './types.ts';

interface AgentRun {
  cwd: string;
  initial: SingleResult;
  args: string[];
  signal: AbortSignal | undefined;
  onUpdate: OnUpdateCallback | undefined;
  makeDetails: MakeDetails;
  maxTurns: number | undefined;
  extraEnv: Readonly<Record<string, string>> | undefined;
}

const ABORTED_BEFORE_START = 'Subagent was aborted before starting';
const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;

/**
 * The tool flags for an agent: its own `tools` (or every built-in tool when only `disallowedTools` is set) less the
 * disallowed ones. An agent that names no tools and bans none keeps Pi's defaults, so it gets no flag. One whose tools
 * are all banned gets `--no-tools`.
 */
function toolFlags(agent: AgentConfig): string[] {
  const banned = new Set((agent.disallowedTools ?? []).map((tool) => tool.toLowerCase()));
  const named = agent.tools ?? [];
  if (named.length === 0 && banned.size === 0) return [];
  const start = named.length > 0 ? named : [...BUILTIN_TOOL_NAMES];
  const allowed = start.filter((tool) => !banned.has(tool.toLowerCase()));
  return allowed.length > 0 ? ['--tools', allowed.join(',')] : ['--no-tools'];
}

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
    ...toolFlags(agent),
    ...(agent.omitContextFiles === true ? ['--no-context-files'] : []),
    ...(promptPath ? ['--append-system-prompt', promptPath] : []),
    `Task: ${task}`,
  ];
}

/** Aborts `controller` when `signal` does, and returns the call that stops listening. */
function followSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  return () => signal?.removeEventListener('abort', abort);
}

async function streamAgent(run: AgentRun): Promise<SingleResult> {
  const childController = new AbortController();
  const stopFollowing = followSignal(run.signal, childController);
  const stream = createResultStream(
    run.initial,
    (result) => {
      run.onUpdate?.({
        content: [{ type: 'text', text: getFinalOutput(result.messages) || '(running...)' }],
        details: run.makeDetails([result]),
      });
    },
    { maxTurns: run.maxTurns, onMaxTurns: () => childController.abort() },
  );
  stream.emit();
  const invocation = getPiInvocation(run.args);
  try {
    const outcome = await runPiInTmux({
      command: invocation.command,
      args: invocation.args,
      cwd: run.cwd,
      signal: childController.signal,
      extraEnv: run.extraEnv,
      onStdoutChunk: stream.onStdoutChunk,
      onStderrChunk: stream.onStderrChunk,
    });
    stream.flush();
    return finalizeResult(stream.result(), outcome, run.signal?.aborted === true, stream.hitMaxTurns());
  } finally {
    stopFollowing();
  }
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
    const systemPrompt = withPreloadedSkills(agent.systemPrompt, agent.skills, cwd);
    prompt = systemPrompt.trim() ? await writePromptToTempFile(agent.name, systemPrompt) : undefined;
    if (signal?.aborted) return { ...initial, status: 'aborted', errorMessage: ABORTED_BEFORE_START };
    const args = buildPiArgs(agent, defaults, call, prompt?.filePath, task);
    return await streamAgent({ cwd, initial, args, signal, onUpdate, makeDetails, maxTurns: agent.maxTurns, extraEnv: defaults.extraEnv });
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
