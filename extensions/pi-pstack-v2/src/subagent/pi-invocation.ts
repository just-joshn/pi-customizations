import * as fs from 'node:fs';
import * as path from 'node:path';

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

const PROMPT_FILE_MODE = 0o600;
const BUN_VIRTUAL_POSIX_PREFIX = '/$bunfs/root/';
const ScriptPathSchema = z.string().optional();

/** Writes an agent's system prompt into the worker's run directory, and returns the file. */
export async function writePromptFile(runDir: string, agentName: string, prompt: string): Promise<string> {
  const safeName = agentName.replace(/[^\w.-]+/g, '_');
  const filePath = path.join(runDir, `prompt-${safeName}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: 'utf-8', mode: PROMPT_FILE_MODE });
  });
  return filePath;
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = ScriptPathSchema.parse(process.argv[1]);
  // Bun-compiled binaries report their embedded entry as argv[1]: "/$bunfs/root/..." on
  // POSIX and "B:/~BUN/root/..." on Windows. fs.existsSync() resolves these inside Bun.
  const isBunVirtualScript = currentScript !== undefined && (currentScript.startsWith(BUN_VIRTUAL_POSIX_PREFIX) || /^[A-Za-z]:[\\/]~BUN[\\/]root[\\/]/.test(currentScript));
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: 'pi', args };
}
