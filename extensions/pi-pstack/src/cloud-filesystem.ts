import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { FilesystemRestriction } from '../scripts/filesystem-launch.mjs';

export async function cloudFilesystem(sessionDirectory: string, directory: string, cwd: string, sessionFile?: string): Promise<FilesystemRestriction> {
  const stores = [sessionDirectory, join(getAgentDir(), 'sessions'), ...(process.env.ORCH_STORE ? [process.env.ORCH_STORE] : [])];
  await Promise.all(stores.map((store) => mkdir(store, { recursive: true })));
  const denied = [...new Set(await Promise.all(stores.map((store) => realpath(store))))];
  const allowed = [...new Set(await Promise.all([directory, cwd].map((path) => realpath(path))))];
  return { denied, allowed, ...(sessionFile ? { files: [await realpath(sessionFile)] } : {}) };
}
