import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Json } from './view.ts';

export function persistedWorkers(repo: string): { runId: string; id: string; dir: string; state: Json; assignment: Json }[] {
  const runs = join(repo, '.pi', 'pstack', 'runs');
  const read = (file: string): Json => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Json;
    } catch {
      return {};
    }
  };
  return (existsSync(runs) ? readdirSync(runs) : []).flatMap((runId) => {
    const workers = join(runs, runId, 'workers');
    return (existsSync(workers) ? readdirSync(workers) : []).map((id) => {
      const dir = join(workers, id);
      return { runId, id, dir, state: read(join(dir, 'state.json')), assignment: read(join(dir, 'assignment.json')) };
    });
  });
}
