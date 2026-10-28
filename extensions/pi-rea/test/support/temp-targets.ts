import { rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onTestFinished } from 'vitest';

export interface TempTargets {
  readonly dir: string;
  readonly write: (name: string, contents: string | Uint8Array, mode?: number) => Promise<string>;
}

export const tempTargets = async (prefix = 'pi-rea-targets-'): Promise<TempTargets> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    write: async (name: string, contents: string | Uint8Array, mode?: number): Promise<string> => {
      const path = join(dir, name);
      await writeFile(path, contents, mode === undefined ? undefined : { mode });
      return path;
    },
  };
};
