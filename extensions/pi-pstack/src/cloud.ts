import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    return (await run('git', ['-C', cwd, ...args])).stdout.trim();
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : String(error);
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${detail}`);
  }
}

async function checkoutRoot(ctx: ExtensionContext): Promise<string> {
  const manager = ctx.sessionManager;
  if (!manager.getSessionFile()) return mkdtemp(join(tmpdir(), 'pstack-cloud-'));
  const dir = resolve(manager.getSessionDir(), 'pstack-cloud');
  await mkdir(dir, { recursive: true });
  return dir;
}

async function resolveBase(top: string, branch: string | undefined): Promise<string> {
  if (!branch) return git(top, 'rev-parse', 'HEAD');
  for (const candidate of [branch, `origin/${branch}`]) {
    const sha = await git(top, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`).catch(() => '');
    if (sha) return sha;
  }
  throw new Error(`cloud_base_branch ${branch} does not resolve locally or on origin. Push or fetch it first.`);
}

export async function cloudCheckout(id: string, requestedCwd: string, branch: string | undefined, ctx: ExtensionContext): Promise<string> {
  const source = await realpath(requestedCwd);
  const top = await git(source, 'rev-parse', '--show-toplevel').catch(() => {
    throw new Error(`environment cloud runs in a git worktree, and ${source} is not inside a git repository.`);
  });
  const base = await resolveBase(top, branch);
  const checkout = join(await checkoutRoot(ctx), id);
  await git(top, 'worktree', 'add', '--detach', checkout, base);
  return realpath(join(checkout, relative(await realpath(top), source)));
}
