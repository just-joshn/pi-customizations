#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { MACHINE_ENV } from '../child-env.ts';
import { type Machine, machinePreface, provisionMachine, releaseMachine, selectDriver } from '../cloud/machine.ts';
import { machinesDir, PACKAGE_ROOT, projectsDir, stateDir, subagentDir, worktreesDir } from '../paths.ts';
import { addWorktree, planWorktree } from '../task/worktree.ts';
import { memoryDir } from './memories.ts';
import { createSupervisor, type FreshMeta } from './supervisor.ts';

function usage(): never {
  console.error('Usage: pstack-routines-supervisor --workspace <cwd>');
  process.exit(2);
}

function parseArgs(argv: string[]): { workspace: string } {
  let workspace: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      workspace = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') usage();
    console.error(`Unknown argument: ${arg}`);
    usage();
  }
  if (workspace === undefined || workspace.trim() === '') usage();
  return { workspace: resolve(workspace) };
}

/** The model, trust, and print arguments a detached new_session fire uses. */
export function freshArgs(meta: FreshMeta): string[] {
  const model = meta.model === undefined ? [] : ['--model', `${meta.model.provider}/${meta.model.id}`, ...(meta.model.thinking === undefined ? [] : ['--thinking', meta.model.thinking])];
  const trust = meta.trusted === undefined ? [] : [meta.trusted ? '--approve' : '--no-approve'];
  return [...trust, ...model, '-p', '--'];
}

/** The text of one JSON-mode assistant message, or undefined for another record. */
export function assistantText(event: unknown): string | undefined {
  const value = event as { type?: unknown; message?: { role?: unknown; content?: unknown } } | null;
  if (value?.type !== 'message_end' || value.message?.role !== 'assistant' || !Array.isArray(value.message.content)) return undefined;
  const text = (value.message.content as { type?: unknown; text?: unknown }[])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
  return text.trim() === '' ? undefined : text;
}

const STDERR_LIMIT = 2_000;

/**
 * A cloud fire's machine, as a cloud agent gets one: a container with a fresh clone of the pushed repository (sharing
 * the Projects folder and this automation's memory), or a git worktree when no container engine answers.
 */
async function cloudMachine(name: string, meta: FreshMeta): Promise<Machine> {
  const agentId = randomUUID();
  const { driver } = await selectDriver();
  if (driver === 'container') return provisionMachine({ driver, agentId, cwd: meta.cwd, home: join(machinesDir(meta.cwd), agentId), baseBranch: undefined, readonly: false, shared: [projectsDir(meta.cwd), memoryDir(name)] });
  const worktree = planWorktree(meta.cwd, worktreesDir(meta.cwd), agentId);
  await addWorktree(meta.cwd, worktree, undefined);
  return worktree;
}

/** Runs one fire with no chat: in the workspace, or on its own cloud machine; resolves with the run's final message. */
async function runFresh(prompt: string, name: string, meta: FreshMeta): Promise<string | undefined> {
  if (meta.environment !== 'cloud') return runPi(prompt, name, meta, meta.cwd, process.env);
  const machine = await cloudMachine(name, meta);
  const env = machine.driver === 'container' ? { ...process.env, [MACHINE_ENV]: JSON.stringify(machine) } : process.env;
  try {
    return await runPi(machinePreface(machine, prompt), name, meta, machine.cwd, env);
  } finally {
    // The fire's Pi runs in the machine's clone, so its subagents keep their run locks in that workspace's state.
    await releaseMachine(machine, subagentDir(machine.cwd)).catch(() => undefined);
  }
}

/** Spawns a headless Pi print run; resolves with its final assistant message once the child exits 0. */
function runPi(prompt: string, name: string, meta: FreshMeta, cwd: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolvePromise, reject) => {
    const raw: unknown = JSON.parse(process.env['PI_PSTACK_PI_COMMAND'] ?? '["pi"]');
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every((part) => typeof part === 'string' && part !== '')) {
      reject(new Error('Invalid Pi command supplied to the subscription supervisor.'));
      return;
    }
    const [executable, ...prefix] = raw as string[];
    if (executable === undefined) {
      reject(new Error(`Could not spawn fire for "${name}" (${meta.subscriptionId}): no pi command`));
      return;
    }
    const child = spawn(executable, [...prefix, '--mode', 'json', '-e', PACKAGE_ROOT, ...freshArgs(meta), prompt], {
      cwd,
      env: { ...env, PI_CODING_AGENT_DIR: resolve(stateDir(), '..') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outcome: string | undefined;
    let buffer = '';
    let stderr = '';
    const decoder = new StringDecoder('utf8');
    // JSONL framing: split only on LF, and keep reading so a full pipe never stalls the child.
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line === '') continue;
        try {
          outcome = assistantText(JSON.parse(line)) ?? outcome;
        } catch {
          // A child extension can print non-JSON to stdout; it is not a session event.
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT);
    });
    child.once('error', (error) => reject(new Error(`Could not spawn fire for "${name}" (${meta.subscriptionId}): ${error.message}`)));
    child.once('exit', (code, signal) => {
      const detail = stderr.trim() === '' ? '' : ` ${stderr.trim()}`;
      if (signal != null) {
        reject(new Error(`Fire for "${name}" (${meta.subscriptionId}) exited from signal ${signal}.${detail}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Fire for "${name}" (${meta.subscriptionId}) exited with code ${code ?? 'null'}.${detail}`));
        return;
      }
      resolvePromise(outcome);
    });
  });
}

export async function main(): Promise<void> {
  const { workspace } = parseArgs(process.argv.slice(2));
  const supervisor = createSupervisor({ workspaceCwd: workspace, runFresh, isDaemon: true });
  const result = await supervisor.start();
  if (!result.started) {
    console.log(`pstack-routines-supervisor already running for ${workspace} (pid ${result.pid}).`);
    process.exit(0);
  }
  console.log(`pstack-routines-supervisor started for ${workspace} (pid ${process.pid}).`);
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      supervisor.stop();
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', () => {
      void supervisor.reconcile();
    });
  });
}
