import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { concurrencyCapMessage } from './admission.ts';
import type { AgentConfig } from './agents.ts';
import { type ModelChoice, resolveModelChoice } from './call.ts';
import { formatForkTask, isForkAgent, SUBAGENT_IS_FORK_ENV, writeForkSession } from './fork.ts';
import { type PreparedMemory, prepareAgentMemory, SUBAGENT_MEMORY_DIR_ENV } from './memory.ts';
import { getPiInvocation, writePromptFile } from './pi-invocation.ts';
import { createResultStream, finalizeResult } from './result-stream.ts';
import { createUnstartedResult, emptyUsage } from './results.ts';
import { runPiInTmux } from './run-in-tmux.ts';
import type { WorkItem } from './schema.ts';
import { PACKAGE_SKILLS_DIR, withPreloadedSkills } from './skill-preload.ts';
import type { DispatchRun, OnProgress, SingleResult, Work } from './types.ts';
import { prepareSubagentWorktree, worktreeNote } from './worktree.ts';

/** Everything one worker needs from the call, before it is started. */
interface Job {
  run: DispatchRun;
  agent: AgentConfig;
  item: WorkItem;
  baseCwd: string;
  initial: SingleResult;
  onProgress: OnProgress | undefined;
}

/** The command line and environment of one worker. */
interface Launch {
  args: string[];
  extraEnv: Readonly<Record<string, string>>;
}

/** Holds what a worker leaves in the temp dir: its prompt, its fork session and the files of its tmux run. */
const RUN_DIR_PREFIX = 'pi-subagent-tmux-';

const ABORTED_BEFORE_START = 'Subagent was aborted before starting';
const BUILTIN_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;
const MEMORY_TOOL_NAMES = ['read', 'write', 'edit'] as const;
const POTETO_MODE_DIR = path.join(PACKAGE_SKILLS_DIR, 'poteto-mode');
const WORKER_KICKOFF_PREFIX = /^Read\s+\S*worker\.md\s+before anything else\./m;

function kickoffTask(agent: AgentConfig, task: string): string {
  if (agent.source !== 'package' || agent.name !== 'poteto-agent' || WORKER_KICKOFF_PREFIX.test(task)) return task;
  return `Read ${path.join(POTETO_MODE_DIR, 'worker.md')} before anything else.\nPoteto-mode skill: ${path.join(POTETO_MODE_DIR, 'SKILL.md')}\n\n${task}`;
}

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
  choice: ModelChoice;
  promptPath: string | undefined;
  task: string;
  forkSessionFile: string | undefined;
}

function buildPiArgs({ agent, choice, promptPath, task, forkSessionFile }: ArgsInput): string[] {
  return [
    '--mode',
    'json',
    '-p',
    ...(forkSessionFile === undefined ? ['--no-session'] : ['--session', forkSessionFile]),
    ...(choice.model ? ['--model', choice.model] : []),
    ...(choice.thinking ? ['--thinking', choice.thinking] : []),
    ...toolFlags(agent),
    ...(agent.omitContextFiles === true ? ['--no-context-files'] : []),
    ...(promptPath ? ['--append-system-prompt', promptPath] : []),
    forkSessionFile === undefined ? `Task: ${kickoffTask(agent, task)}` : formatForkTask(task),
  ];
}

async function streamAgent(job: Job, cwd: string, runDir: string, launch: Launch): Promise<SingleResult> {
  const { run, agent, initial } = job;
  const turnLimit = new AbortController();
  const signal = run.signal ? AbortSignal.any([run.signal, turnLimit.signal]) : turnLimit.signal;
  const stream = createResultStream(initial, (result) => job.onProgress?.(result), { maxTurns: agent.maxTurns, onMaxTurns: () => turnLimit.abort() });
  stream.emit();
  const invocation = getPiInvocation(launch.args);
  const outcome = await runPiInTmux({
    command: invocation.command,
    args: invocation.args,
    cwd,
    runDir,
    signal,
    extraEnv: launch.extraEnv,
    onStdoutChunk: stream.onStdoutChunk,
    onStderrChunk: stream.onStderrChunk,
  });
  stream.flush();
  return finalizeResult(stream.result(), outcome, run.signal?.aborted === true, stream.hitMaxTurns());
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What an awaited step gave, or the error it ended in, so a caller can tell a step that failed from the work after it. */
type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

const attempt = <T>(step: () => Promise<T>): Promise<Attempt<T>> =>
  step().then(
    (value): Attempt<T> => ({ ok: true, value }),
    (error: unknown): Attempt<T> => ({ ok: false, error }),
  );

/** Memory, skills and the agent prompt, as the one system prompt the worker is given. */
function systemPromptFor(agent: AgentConfig, cwd: string, memorySection: string | undefined): string {
  const withSkills = withPreloadedSkills(agent.systemPrompt, agent.skills, cwd);
  return memorySection ? [withSkills.trim(), memorySection].filter(Boolean).join('\n\n') : withSkills;
}

/**
 * The memory directory a child's VM must mount: the user scope's, and any scope's when the child runs in a worktree, where
 * it lies outside the workspace. An agent without memory gets '' so a directory inherited from the parent never reaches it.
 */
function memoryDirFor(memory: PreparedMemory | undefined, agent: AgentConfig, inWorktree: boolean): string {
  return memory && (agent.memory === 'user' || inWorktree) ? memory.dir : '';
}

/** Writes the worker's prompt and fork session into `runDir`, and works out its command line and environment. */
async function prepareLaunch(job: Job, cwd: string, runDir: string): Promise<Launch> {
  const { run, agent, item } = job;
  const memory = agent.memory ? prepareAgentMemory(agent.memory, agent.name, job.baseCwd, getAgentDir()) : undefined;
  const systemPrompt = systemPromptFor(agent, cwd, memory?.promptSection);
  const promptPath = systemPrompt.trim() ? await writePromptFile(runDir, agent.name, systemPrompt) : undefined;
  const forkSessionFile = isForkAgent(agent) ? writeForkSession(run.defaults.parentSession ?? { file: undefined, cwd, toolCallId: undefined }, runDir) : undefined;
  const choice = resolveModelChoice(agent, item, run.defaults);
  const args = buildPiArgs({ agent, choice, promptPath, task: item.task, forkSessionFile });
  const memoryEnv = { [SUBAGENT_MEMORY_DIR_ENV]: memoryDirFor(memory, agent, cwd !== job.baseCwd) };
  const forkEnv = forkSessionFile ? { [SUBAGENT_IS_FORK_ENV]: '1' } : {};
  return { args, extraEnv: { ...run.defaults.extraEnv, ...memoryEnv, ...forkEnv } };
}

const failedBeforeStart = (initial: SingleResult, error: unknown): SingleResult => ({ ...initial, status: 'failed', errorMessage: errorText(error) });

/** Runs the worker in `cwd`, with one run directory that is removed however the run ends. */
async function runInCwd(job: Job, cwd: string): Promise<SingleResult> {
  const created = await attempt(() => fs.promises.mkdtemp(path.join(os.tmpdir(), RUN_DIR_PREFIX)));
  if (!created.ok) return failedBeforeStart(job.initial, created.error);
  const runDir = created.value;
  try {
    const launch = await attempt(() => prepareLaunch(job, cwd, runDir));
    if (!launch.ok) return failedBeforeStart(job.initial, launch.error);
    if (job.run.signal?.aborted) return { ...job.initial, status: 'aborted', errorMessage: ABORTED_BEFORE_START };
    return await streamAgent(job, cwd, runDir, launch.value);
  } finally {
    await fs.promises.rm(runDir, { recursive: true, force: true });
  }
}

/** Runs the worker in its own git worktree when the call or the agent asks for one, and says where the worktree is if it was kept. */
async function runResolvedAgent(job: Job): Promise<SingleResult> {
  const { agent, item, baseCwd } = job;
  if (item.isolation !== 'worktree' && agent.isolation !== 'worktree') return runInCwd(job, baseCwd);
  const prepared = await attempt(() => prepareSubagentWorktree(baseCwd, agent.name));
  if (!prepared.ok) return failedBeforeStart(job.initial, prepared.error);
  const worktree = prepared.value;
  const result = await runInCwd(job, worktree.worktreePath).catch(async (error: unknown) => {
    await worktree.finalize();
    throw error;
  });
  const outcome = await worktree.finalize();
  return outcome.kept ? { ...result, worktreeNote: worktreeNote(outcome) } : result;
}

/**
 * Runs one worker and returns its result, calling `onProgress` as the result changes. The worker holds one of the gate's
 * slots from here to its end, so a chain takes one at a time and a parallel call as many as it runs at once.
 */
export async function runSingleAgent(run: DispatchRun, { item, resolved }: Work, step: number | undefined, onProgress?: OnProgress): Promise<SingleResult> {
  const { agent: agentName, task } = item;
  if (run.signal?.aborted) return createUnstartedResult(agentName, task, step, 'aborted', ABORTED_BEFORE_START);
  const { agent, cwd } = resolved;
  if (!agent) {
    const available = resolved.available.map((candidate) => `"${candidate.name}"`).join(', ') || 'none';
    return createUnstartedResult(agentName, task, step, 'failed', `Unknown agent: "${agentName}". Available agents: ${available}.`);
  }
  const slot = run.gate.tryAcquire();
  if (!slot) return createUnstartedResult(agentName, task, step, 'failed', concurrencyCapMessage(run.gate.limit()));
  try {
    const { model } = resolveModelChoice(agent, item, run.defaults);
    const initial: SingleResult = { agent: agentName, agentSource: agent.source, task, status: 'running', exitCode: null, messages: [], stderr: '', usage: emptyUsage(), model, step };
    return await runResolvedAgent({ run, agent, item, baseCwd: cwd, initial, onProgress });
  } finally {
    slot.release();
  }
}
