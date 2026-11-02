#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { PACKAGE_ROOT } from '../paths.ts';
import { createSupervisor } from './supervisor.ts';

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

/** Spawns a headless Pi print run; resolves only when the child exits 0. */
function runFresh(prompt: string, name: string, meta: { subscriptionId: string; cwd: string }): Promise<void> {
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
    const child = spawn(executable, [...prefix, '--mode', 'json', '-e', PACKAGE_ROOT, '-p', '--', prompt], {
      cwd: meta.cwd,
      env: process.env,
      stdio: 'ignore',
    });
    child.once('error', (error) => reject(new Error(`Could not spawn fire for "${name}" (${meta.subscriptionId}): ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (signal != null) {
        reject(new Error(`Fire for "${name}" (${meta.subscriptionId}) exited from signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Fire for "${name}" (${meta.subscriptionId}) exited with code ${code ?? 'null'}`));
        return;
      }
      resolvePromise();
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
