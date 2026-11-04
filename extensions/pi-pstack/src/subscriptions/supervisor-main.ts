#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

import { PACKAGE_ROOT } from '../paths.ts';
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

/** Spawns a headless Pi print run; resolves with its final assistant message once the child exits 0. */
function runFresh(prompt: string, name: string, meta: FreshMeta): Promise<string | undefined> {
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
      cwd: meta.cwd,
      env: process.env,
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

async function main(): Promise<void> {
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

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
