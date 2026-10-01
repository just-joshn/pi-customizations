import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { type TaskRecord, TaskRecordSchema } from './worker-records.ts';

const run = promisify(execFile);
const LaunchSchema = Type.Object({ repository: Type.String(), branch: Type.String(), record: TaskRecordSchema });

async function repositoryScope(cwd: string) {
  const repository = await realpath((await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])).stdout.trim());
  const key = createHash('sha256').update(repository).digest('hex');
  return { repository, directory: join(getAgentDir(), 'pstack-task-index', key) };
}

export async function publishTask(record: TaskRecord, cwd: string, branch?: string): Promise<string> {
  if (!Check(TaskRecordSchema, record) || !record.detached?.remote || !/^[a-zA-Z0-9-]+$/.test(record.id)) throw new Error('Invalid remote task discovery record.');
  const scope = await repositoryScope(cwd);
  const sourceBranch = branch ?? (await run('git', ['-C', cwd, 'symbolic-ref', '--short', '-q', 'HEAD']).catch(() => ({ stdout: '' }))).stdout.trim();
  const receipt = { repository: scope.repository, branch: sourceBranch, record };
  await mkdir(scope.directory, { recursive: true, mode: 0o700 });
  const path = join(scope.directory, `${record.id}.json`), temporary = join(scope.directory, `${record.id}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
  await rename(temporary, path);
  return path;
}

export async function discoverTasks(cwd: string, branch?: string) {
  const scope = await repositoryScope(cwd);
  const names = await readdir(scope.directory).catch((error) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
  const receipts = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
    const receipt: unknown = JSON.parse(await readFile(join(scope.directory, name), 'utf8'));
    if (!Check(LaunchSchema, receipt) || receipt.repository !== scope.repository || !receipt.record.detached?.remote) throw new Error('Invalid remote task discovery receipt.');
    return receipt;
  }));
  return receipts.filter((item) => branch === undefined || item.branch === branch);
}

export async function selectTask(cwd: string, selector: { task_id?: string; branch?: string }) {
  if (Boolean(selector.task_id) === Boolean(selector.branch)) throw new Error('TaskAttach requires exactly one selector: task_id or branch.');
  const matches = (await discoverTasks(cwd, selector.branch)).filter((item) => selector.task_id === undefined || item.record.id === selector.task_id);
  if (matches.length !== 1) throw new Error('TaskAttach must resolve exactly one repository task. Select an explicit task_id from TaskList.');
  return matches[0];
}
