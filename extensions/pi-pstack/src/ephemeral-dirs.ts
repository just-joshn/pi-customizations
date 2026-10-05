import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// An unpersisted session has no session directory, so its stores live in the temp directory.
// They belong to that session and are removed when it shuts down.
export class EphemeralDirs {
  private readonly prefix: string;
  private readonly owned = new WeakMap<object, Set<string>>();

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  async create(owner: object): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), this.prefix));
    this.owned.set(owner, (this.owned.get(owner) ?? new Set<string>()).add(dir));
    return dir;
  }

  async removeAll(owner: object): Promise<void> {
    const dirs = this.owned.get(owner);
    if (!dirs) return;
    this.owned.delete(owner);
    await Promise.all([...dirs].map((dir) => rm(dir, { recursive: true, force: true })));
  }
}
