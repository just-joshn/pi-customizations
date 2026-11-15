import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { attachCommand, claimWake, type Job, type JobSpec, launch, list, newJobId, outputPath, read, STOPPED_EXIT_CODE, stop, tail } from './jobs.ts';
import { JOB_DIR_ENV, SANDBOX_ENV, sandboxed } from './sandbox.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = ['poteto-agent', 'comment-sicko', 'ci-watcher', 'thermo-nuclear-code-quality-review'] as const;
const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const POLL_MS = 2000;
const REPORT_LIMIT = 20000;

export const modelsFile = (agentDir: string): string => join(agentDir, 'pstack-v2-models.md');
// A sandboxed worker can write only inside its own job directory's `nested/`, so the jobs it starts live there.
const jobsRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  const parent = env[JOB_DIR_ENV];
  return env[SANDBOX_ENV] === '1' && parent ? join(parent, 'nested') : join(getAgentDir(), 'pstack-v2', 'jobs');
};
// A plain string enum, which every provider accepts, typed for TypeBox inference.
const stringEnum = <T extends readonly string[]>(values: T, description?: string) => Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined });

const stripFrontmatter = (markdown: string): string => markdown.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const rules = ['no-inline-imports', 'typescript-exhaustive-switch'].map((name) => stripFrontmatter(readFileSync(join(packageRoot, 'rules', `${name}.md`), 'utf8')).replace(/^#.*\n+/, ''));

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitCommonDir(cwd: string): string | undefined {
  try {
    return resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']));
  } catch {
    return undefined;
  }
}

function addWorktree(cwd: string, path: string, branch: string, base: string | undefined): void {
  let exists = true;
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  } catch {
    exists = false;
  }
  git(cwd, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, base ?? 'HEAD']);
}

function report(job: Job): string {
  const state = job.status.state === 'exited' ? `exited with code ${job.status.code}` : 'was lost (its tmux session ended without an exit code)';
  const full = existsSync(outputPath(job.dir)) ? readFileSync(outputPath(job.dir), 'utf8') : '';
  const body = job.spec.kind === 'pi' ? full.slice(-REPORT_LIMIT) : tail(job.dir, 60);
  return [`tmux job ${job.spec.name} (${job.spec.id}) ${state}. Full output: ${outputPath(job.dir)}`, job.spec.wake ?? '', `<output>\n${body.trim()}\n</output>`].filter(Boolean).join('\n\n');
}

function describe(job: Job): string {
  const state = job.status.state === 'exited' ? `exited ${job.status.code}` : job.status.state;
  return `${job.spec.id}  ${job.spec.kind}  ${state}  ${job.spec.name}\n  output: ${outputPath(job.dir)}\n  attach: ${attachCommand(job.spec)}`;
}

function resolveModel(ctx: ExtensionContext, model: string | undefined): string | undefined {
  if (model === undefined) return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
  const slash = model.indexOf('/');
  if (slash < 1 || !ctx.modelRegistry.find(model.slice(0, slash), model.slice(slash + 1))) {
    throw new Error(`Unknown model "${model}". Pass provider/id exactly as \`pi --list-models\` prints it, or omit model to use the parent's model.`);
  }
  return model;
}

export default function pstack(pi: ExtensionAPI) {
  let watcher: ReturnType<typeof setInterval> | undefined;
  // Jobs a tmux_jobs wait call is blocking on. Their report goes back as that call's result, not as a wake.
  const awaited = new Set<string>();

  const relaunch = (job: Job): void => {
    const spec: JobSpec = { ...job.spec, id: newJobId(job.spec.name), createdAt: new Date().toISOString() };
    launch(jobsRoot(), spec);
  };

  const deliverFinished = (ctx: ExtensionContext): void => {
    const owner = ctx.sessionManager.getSessionId();
    const jobs = list(jobsRoot(), owner);
    for (const job of jobs) {
      if (job.spec.wake === null || job.status.state === 'running' || awaited.has(job.spec.id) || !claimWake(job)) continue;
      pi.sendMessage({ customType: 'pstack-job', content: report(job), display: true }, { triggerTurn: true, deliverAs: 'followUp' });
      if (job.spec.repeat && job.status.state === 'exited' && job.status.code !== STOPPED_EXIT_CODE) relaunch(job);
    }
    if (ctx.hasUI) {
      const running = jobs.filter((job) => job.status.state === 'running').length;
      ctx.ui.setStatus('pstack', running ? `tmux jobs: ${running} running` : undefined);
    }
  };

  const interactive = (ctx: ExtensionContext): boolean => ctx.mode === 'tui' || ctx.mode === 'rpc';

  pi.on('session_start', async (_event, ctx) => {
    if (!interactive(ctx)) return;
    clearInterval(watcher);
    watcher = setInterval(() => deliverFinished(ctx), POLL_MS);
  });

  pi.on('session_shutdown', async () => {
    clearInterval(watcher);
    watcher = undefined;
  });

  // A print-mode run would exit while its jobs still run, so it waits for them and continues with their reports.
  pi.on('agent_before_settle', async (event, ctx) => {
    if (interactive(ctx)) return;
    const owner = ctx.sessionManager.getSessionId();
    const pending = () => list(jobsRoot(), owner).filter((job) => job.spec.wake !== null && !job.spec.repeat && !existsSync(join(job.dir, 'woken')));
    if (pending().length === 0) return;
    while (pending().some((job) => job.status.state === 'running')) await new Promise((done) => setTimeout(done, POLL_MS));
    const finished = pending().filter(claimWake);
    return {
      entries: [...event.entries, ...finished.map((job) => ({ type: 'custom_message' as const, customType: 'pstack-job', content: report(job), display: true }))],
      continue: true,
    };
  });

  pi.on('before_agent_start', async (event) => {
    const options = event.systemPromptOptions;
    for (const rule of rules) if (!options.promptGuidelines.includes(rule)) options.promptGuidelines.push(rule);
    const models = modelsFile(getAgentDir());
    if (existsSync(models)) options.sections['pstack-models'] = `Role lines from ${models}, written by /skill:setup-pstack:\n${readFileSync(models, 'utf8').trim()}`;
  });

  pi.registerTool({
    name: 'pi_spawn',
    label: 'Spawn Pi',
    description:
      'Start a separate Pi process in its own tmux session, inside a Seatbelt (macOS) or bubblewrap (Linux) sandbox, with a standalone brief. It runs in parallel and does not see this conversation. When it exits you are woken with its final report. Each call starts one fresh instance; to start several, call pi_spawn several times in one message.',
    promptSnippet: 'Start a parallel Pi instance in tmux with a standalone brief, then get woken with its report',
    promptGuidelines: [
      'Use pi_spawn wherever a pstack skill says to spawn a worker, delegate, explorer, reviewer, or Pi instance. Pi has no subagents.',
      'Write each pi_spawn brief so it stands alone. The spawned Pi sees only the brief, never this conversation.',
    ],
    parameters: Type.Object({
      name: Type.String({ description: 'Short label for the job, such as "explorer-auth" or "runner-2".' }),
      brief: Type.String({ description: 'The complete standalone prompt for the spawned Pi.' }),
      agent: Type.Optional(stringEnum(AGENTS, 'Role instructions from pstack agents/<agent>.md, appended to the spawned system prompt.')),
      model: Type.Optional(Type.String({ description: 'provider/id as `pi --list-models` prints it. Omit to use this session model.' })),
      thinking: Type.Optional(stringEnum(THINKING, 'Thinking level. Omit to use the model default.')),
      readonly: Type.Optional(Type.Boolean({ description: 'Deny every write except to the worker session and remove the edit and write tools. Default false.' })),
      worktree: Type.Optional(Type.String({ description: 'Branch for a new git worktree the spawned Pi works in, created from base. Writes are confined to that worktree.' })),
      base: Type.Optional(Type.String({ description: 'Ref the new worktree branch starts from. Default HEAD.' })),
      cwd: Type.Optional(Type.String({ description: 'Working directory when no worktree is requested. Default this session cwd.' })),
      resume: Type.Optional(Type.String({ description: 'Job id of a finished pi_spawn job whose session the brief continues. Use only when that session holds state too costly to move.' })),
      wake: Type.Optional(Type.Boolean({ description: 'Wake this session with the report when the job exits. Default true.' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const root = jobsRoot();
      const id = newJobId(params.name);
      const dir = join(root, id);
      const owner = ctx.sessionManager.getSessionId();
      const prior = params.resume === undefined ? undefined : read(root, params.resume);
      if (params.resume !== undefined && (prior === undefined || prior.spec.kind !== 'pi' || prior.status.state === 'running')) {
        throw new Error(`resume needs a finished pi_spawn job id, got "${params.resume}".`);
      }
      const model = resolveModel(ctx, params.model);
      const base = params.cwd === undefined ? ctx.cwd : resolve(ctx.cwd, params.cwd);
      try {
        return start();
      } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        if (params.worktree !== undefined) gitCommonDir(base) && git(base, ['worktree', 'prune']);
        throw error;
      }

      function start() {
        let cwd = prior?.spec.cwd ?? base;
        // The job directory itself stays read-only to the worker, so it cannot rewrite its own spec or exit code.
        const sessionDir = prior ? join(prior.dir, 'session') : join(dir, 'session');
        const writable = [sessionDir, join(dir, 'nested')];
        for (const path of writable) mkdirSync(path, { recursive: true });
        if (params.worktree !== undefined && prior === undefined) {
          cwd = join(dir, 'worktree');
          addWorktree(base, cwd, params.worktree, params.base);
        }
        const common = gitCommonDir(cwd);
        if (!params.readonly) writable.push(cwd, ...(common ? [common] : []));
        const piCommand = process.argv[1] && isAbsolute(process.argv[1]) ? [process.execPath, process.argv[1]] : ['pi'];
        const argv = [
          ...piCommand,
          '-p',
          '--session-dir',
          sessionDir,
          ...(prior ? ['--continue'] : []),
          ...(model ? ['--model', model] : []),
          ...(params.thinking ? ['--thinking', params.thinking] : []),
          ...(params.agent ? ['--append-system-prompt', join(dir, 'agent.md')] : []),
          ...(params.readonly ? ['--exclude-tools', 'edit,write'] : []),
          ctx.isProjectTrusted() ? '--approve' : '--no-approve',
          `@${join(dir, 'brief.md')}`,
        ];
        const files: Record<string, string> = { 'brief.md': params.brief };
        if (params.agent) files['agent.md'] = stripFrontmatter(readFileSync(join(packageRoot, 'agents', `${params.agent}.md`), 'utf8'));
        const spec: JobSpec = {
          id,
          name: params.name,
          kind: 'pi',
          cwd,
          argv: sandboxed(argv, { writable, agentDir: getAgentDir() }),
          owner,
          wake: params.wake === false ? null : 'Review this report against the brief and inspect the artifacts it names before you rely on it.',
          repeat: false,
          createdAt: new Date().toISOString(),
        };
        const job = launch(root, spec, files);
        return text(`Started ${describe(job)}\n  cwd: ${cwd}${spec.wake ? '\nYou will be woken with its report when it exits. Keep working or end your turn.' : ''}`);
      }
    },
  });

  pi.registerTool({
    name: 'tmux_run',
    label: 'Run in tmux',
    description:
      'Run a shell command in its own tmux session, inside the pstack sandbox, instead of a background shell. Use it for watchers, dev servers, long builds, and heartbeat timers. With wake set, you are woken with that message and the output tail when the command exits. With repeat, the command restarts each time it exits, so `sleep 3600` plus a wake message is an hourly tick.',
    promptSnippet: 'Run a long-lived or watched command in tmux and get woken when it exits',
    promptGuidelines: ['Use tmux_run for any command that would otherwise run in the background. Never background a command with &, nohup, setsid, or disown.'],
    parameters: Type.Object({
      name: Type.String({ description: 'Short label, such as "watch-pr-123" or "dev-server".' }),
      command: Type.String({ description: 'Shell command, run with bash -c.' }),
      cwd: Type.Optional(Type.String({ description: 'Working directory. Default this session cwd. The command may write only here, in its git directory, and in temp directories.' })),
      wake: Type.Optional(Type.String({ description: 'Message to wake this session with when the command exits. Omit for a server you will stop yourself.' })),
      repeat: Type.Optional(Type.Boolean({ description: 'Restart the command after each exit and wake each time. Requires wake. Stop it with tmux_jobs stop.' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.repeat && params.wake === undefined) throw new Error('repeat needs a wake message, or nothing would ever notice the ticks.');
      const root = jobsRoot();
      const id = newJobId(params.name);
      const cwd = params.cwd === undefined ? ctx.cwd : resolve(ctx.cwd, params.cwd);
      const common = gitCommonDir(cwd);
      const spec: JobSpec = {
        id,
        name: params.name,
        kind: 'command',
        cwd,
        argv: sandboxed(['bash', '-c', params.command], { writable: [cwd, ...(common ? [common] : [])], agentDir: getAgentDir() }),
        owner: ctx.sessionManager.getSessionId(),
        wake: params.wake ?? null,
        repeat: params.repeat ?? false,
        createdAt: new Date().toISOString(),
      };
      return text(`Started ${describe(launch(root, spec))}`);
    },
  });

  pi.registerTool({
    name: 'tmux_jobs',
    label: 'tmux jobs',
    description:
      "Inspect or control this session's pi_spawn and tmux_run jobs. list shows every job with its state, output path, and tmux attach command. output prints the last lines of one job. wait blocks until the named jobs (default all running) exit or the timeout passes, then returns their reports. stop ends jobs and suppresses their wake.",
    parameters: Type.Object({
      action: stringEnum(['list', 'output', 'wait', 'stop'] as const),
      ids: Type.Optional(Type.Array(Type.String(), { description: 'Job ids. Required for output and stop.' })),
      lines: Type.Optional(Type.Number({ description: 'Lines for output. Default 80.' })),
      timeout_seconds: Type.Optional(Type.Number({ description: 'Longest wait. Default 1800.' })),
    }),
    async execute(_id, params, signal, update, ctx) {
      const root = jobsRoot();
      const owner = ctx.sessionManager.getSessionId();
      const named = (): Job[] => {
        if (!params.ids?.length) throw new Error(`${params.action} needs ids.`);
        return params.ids.map((id) => {
          const job = read(root, id);
          if (!job || job.spec.owner !== owner) throw new Error(`No job ${id} in this session.`);
          return job;
        });
      };
      switch (params.action) {
        case 'list': {
          const jobs = list(root, owner);
          return text(jobs.length ? jobs.map(describe).join('\n') : 'No jobs in this session.');
        }
        case 'output':
          return text(
            named()
              .map((job) => `${describe(job)}\n${tail(job.dir, params.lines ?? 80)}`)
              .join('\n\n'),
          );
        case 'stop': {
          const jobs = named();
          for (const job of jobs) stop(job);
          return text(`Stopped ${jobs.map((job) => job.spec.id).join(', ')}.`);
        }
        case 'wait': {
          const ids = params.ids?.length
            ? params.ids
            : list(root, owner)
                .filter((job) => job.status.state === 'running')
                .map((job) => job.spec.id);
          const deadline = Date.now() + (params.timeout_seconds ?? 1800) * 1000;
          const current = () => ids.map((id) => read(root, id)).filter((job): job is Job => job !== undefined && job.spec.owner === owner);
          for (const id of ids) awaited.add(id);
          try {
            while (current().some((job) => job.status.state === 'running') && Date.now() < deadline && !signal?.aborted) {
              update?.(text(`Waiting on ${current().filter((job) => job.status.state === 'running').length} job(s)...`));
              await new Promise((done) => setTimeout(done, POLL_MS));
            }
            const jobs = current();
            for (const job of jobs) if (job.status.state !== 'running') claimWake(job);
            return text(jobs.map((job) => (job.status.state === 'running' ? `${describe(job)}\n  still running` : report(job))).join('\n\n') || 'No jobs to wait on.');
          } finally {
            for (const id of ids) awaited.delete(id);
          }
        }
        default: {
          const unreachable: never = params.action;
          throw new Error(`Unknown action ${String(unreachable)}`);
        }
      }
    },
  });
}
