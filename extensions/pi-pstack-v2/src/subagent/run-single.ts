import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { AgentConfig } from './agents.ts';
import { formatForkTask, type ForkSession, isForkAgent, prepareForkSession, SUBAGENT_IS_FORK_ENV } from './fork.ts';
import { prepareAgentMemory, SUBAGENT_MEMORY_DIR_ENV } from './memory.ts';
import { getPiInvocation, removePromptTempFile, writePromptToTempFile } from './pi-invocation.ts';
import { createResultStream, finalizeResult } from './result-stream.ts';
import { createUnstartedResult, emptyUsage, getFinalOutput } from './results.ts';
import { runPiInTmux } from './run-in-tmux.ts';
import { withPreloadedSkills } from './skill-preload.ts';
import type { CallModel, DispatchDefaults, MakeDetails, OnUpdateCallback, ResolvedAgent, SingleResult } from './types.ts';
import { prepareSubagentWorktree, worktreeNote } from './worktree.ts';

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

/** Everything one worker needs from the call, before it is started. */
interface Job {
  defaults: DispatchDefaults;
  agent: AgentConfig;
  call: CallModel;
  baseCwd: string;
  task: string;
  signal: AbortSignal | undefined;
  onUpdate: OnUpdateCallback | undefined;
  makeDetails: MakeDetails;
  initial: SingleResult;
}

/** The command line, environment and cleanup of one worker. */
interface Launch {
  args: string[];
  extraEnv: Readonly<Record<string, string>>;
  cleanup: () => void;
}

const ABORTED_BEFORE_START = 'Subagent was aborted before starting';
const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;
const MEMORY_TOOL_NAMES = ['read', 'write', 'edit'] as const;

/** The tools an agent names, plus the ones it needs to keep its memory when it has memory and a restricted tool list. */
function declaredTools(agent: AgentConfig): string[] {
  const named = agent.tools ?? [];
  if (!agent.memory || named.length === 0) return named;
  const have = new Set(named.map((tool) => tool.toLowerCase()));
  return [...named, ...MEMORY_TOOL_NAMES.filter((tool) => !have.has(tool))];
}

/**
 * The tool flags for an agent: its own `tools` (or every built-in tool when only `disallowedTools` is set) less the
 * disallowed ones. An agent that names no tools and bans none keeps Pi's defaults, so it gets no flag. One whose tools
 * are all banned gets `--no-tools`.
 */
function toolFlags(agent: AgentConfig): string[] {
  const banned = new Set((agent.disallowedTools ?? []).map((tool) => tool.toLowerCase()));
  const named = declaredTools(agent);
  if (named.length === 0 && banned.size === 0) return [];
  const start = named.length > 0 ? named : [...BUILTIN_TOOL_NAMES];
  const allowed = start.filter((tool) => !banned.has(tool.toLowerCase()));
  return allowed.length > 0 ? ['--tools', allowed.join(',')] : ['--no-tools'];
}

interface ArgsInput {
  agent: AgentConfig;
  defaults: DispatchDefaults;
  call: CallModel;
  promptPath: string | undefined;
  task: string;
  forkSessionFile: string | undefined;
}

/**
 * A model named by the call or the agent runs at its own default thinking level unless the call names one. A fork names
 * neither: it keeps the parent's model, thinking level and system prompt so its prompt prefix matches the parent's cache.
 */
function buildPiArgs({ agent, defaults, call, promptPath, task, forkSessionFile }: ArgsInput): string[] {
  const fork = forkSessionFile !== undefined;
  const namedModel = fork ? undefined : (call.model ?? agent.model);
  const model = namedModel ?? defaults.model;
  const thinking = fork ? defaults.thinkingLevel : (call.thinking ?? (namedModel ? undefined : defaults.thinkingLevel));
  return [
    '--mode',
    'json',
    '-p',
    ...(forkSessionFile === undefined ? ['--no-session'] : ['--session', forkSessionFile]),
    ...(model ? ['--model', model] : []),
    ...(thinking ? ['--thinking', thinking] : []),
    ...toolFlags(agent),
    ...(agent.omitContextFiles === true ? ['--no-context-files'] : []),
    ...(promptPath ? ['--append-system-prompt', promptPath] : []),
    forkSessionFile === undefined ? `Task: ${task}` : formatForkTask(task) ,
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

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Memory, skills and the agent prompt, as the one system prompt the worker is given. */
function systemPromptFor(agent: AgentConfig, cwd: string, memorySection: string | undefined): string {
  const withSkills = withPreloadedSkills(agent.systemPrompt, agent.skills, cwd);
  return memorySection ? [withSkills.trim(), memorySection].filter(Boolean).join('\n\n') : withSkills;
}

function startForkSession(job: Job, cwd: string): ForkSession | undefined {
  if (!isForkAgent(job.agent)) return undefined;
  return prepareForkSession(job.defaults.parentSession ?? { file: undefined, cwd, toolCallId: undefined });
}

async function prepareLaunch(job: Job, cwd: string): Promise<Launch> {
  const { agent, defaults, call, task } = job;
  const memory = agent.memory ? prepareAgentMemory(agent.memory, agent.name, job.baseCwd, getAgentDir()) : undefined;
  const systemPrompt = systemPromptFor(agent, cwd, memory?.promptSection);
  const prompt = systemPrompt.trim() ? await writePromptToTempFile(agent.name, systemPrompt) : undefined;
  const fork = startForkSession(job, cwd);
  const args = buildPiArgs({ agent, defaults, call, promptPath: prompt?.filePath, task, forkSessionFile: fork?.sessionFile });
  const memoryEnv = memory && agent.memory === 'user' ? { [SUBAGENT_MEMORY_DIR_ENV]: memory.dir } : {};
  const forkEnv = fork ? { [SUBAGENT_IS_FORK_ENV]: '1' } : {};
  return {
    args,
    extraEnv: { ...defaults.extraEnv, ...memoryEnv, ...forkEnv },
    cleanup: () => {
      removePromptTempFile(prompt);
      fork?.cleanup();
    },
  };
}

const failedBeforeStart = (initial: SingleResult, error: unknown): SingleResult => ({ ...initial, status: 'failed', errorMessage: errorText(error) });

async function runInCwd(job: Job, cwd: string): Promise<SingleResult> {
  const prepared = await prepareLaunch(job, cwd).then(
    (launch) => ({ launch }),
    (error: unknown) => ({ error }),
  );
  if ('error' in prepared) return failedBeforeStart(job.initial, prepared.error);
  const { launch } = prepared;
  try {
    if (job.signal?.aborted) return { ...job.initial, status: 'aborted', errorMessage: ABORTED_BEFORE_START };
    const { initial, signal, onUpdate, makeDetails, agent } = job;
    return await streamAgent({ cwd, initial, args: launch.args, signal, onUpdate, makeDetails, maxTurns: agent.maxTurns, extraEnv: launch.extraEnv });
  } finally {
    launch.cleanup();
  }
}

/** Runs the worker in its own git worktree when the call or the agent asks for one, and says where the worktree is if it was kept. */
async function runResolvedAgent(job: Job): Promise<SingleResult> {
  const { agent, call, baseCwd } = job;
  if (call.isolation !== 'worktree' && agent.isolation !== 'worktree') return runInCwd(job, baseCwd);
  const prepared = await prepareSubagentWorktree(baseCwd, agent.name).then(
    (worktree) => ({ worktree }),
    (error: unknown) => ({ error }),
  );
  if ('error' in prepared) return failedBeforeStart(job.initial, prepared.error);
  const { worktree } = prepared;
  const result = await runInCwd(job, worktree.worktreePath).catch(async (error: unknown) => {
    await worktree.finalize();
    throw error;
  });
  const outcome = await worktree.finalize();
  return outcome.kept ? { ...result, worktreeNote: worktreeNote(outcome) } : result;
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
  const { agent, cwd, call = {} } = resolved;
  if (!agent) {
    const available = resolved.available.map((candidate) => `"${candidate.name}"`).join(', ') || 'none';
    return createUnstartedResult(agentName, task, step, 'failed', `Unknown agent: "${agentName}". Available agents: ${available}.`);
  }
  const model = isForkAgent(agent) ? defaults.model : (call.model ?? agent.model ?? defaults.model);
  const initial: SingleResult = { agent: agentName, agentSource: agent.source, task, status: 'running', exitCode: null, messages: [], stderr: '', usage: emptyUsage(), model, step };
  return runResolvedAgent({ defaults, agent, call, baseCwd: cwd, task, signal, onUpdate, makeDetails, initial });
}
