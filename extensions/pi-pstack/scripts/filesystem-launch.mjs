import { realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function filesystemLaunch(executable, args, directory, filesystem) {
  if (!filesystem) return { executable, args };
  if (process.platform !== 'darwin') throw new Error('Requested filesystem restriction requires macOS sandbox-exec. Unsandboxed fallback is not permitted.');
  if (!Array.isArray(filesystem.denied) || !filesystem.denied.length || !Array.isArray(filesystem.allowed) || ![...filesystem.denied, ...filesystem.allowed].every((path) => typeof path === 'string' && path.length > 0))
    throw new Error('Invalid filesystem restriction directories.');
  const denied = await Promise.all(filesystem.denied.map((path) => realpath(path)));
  const allowed = await Promise.all(filesystem.allowed.map((path) => realpath(path)));
  if (denied.some((path) => allowed.some((parent) => path === parent || path.startsWith(parent === '/' ? '/' : `${parent}/`)))) throw new Error('A coordinator store cannot also be an allowed task directory.');
  const files = await Promise.all((filesystem.files ?? []).map((path) => realpath(path)));
  for (const path of files) if (!(await stat(path)).isFile()) throw new Error('Allowed legacy session path must be a file.');
  const exceptions = [...allowed.map((path) => `(require-not (subpath ${JSON.stringify(path)}))`), ...files.map((path) => `(require-not (literal ${JSON.stringify(path)}))`)].join(' ');
  const rules = denied.map((path) => `(deny file-read* (require-all (subpath ${JSON.stringify(path)}) ${exceptions}))`).join('\n');
  const profile = join(directory, 'filesystem.sb');
  await writeFile(profile, `(version 1)\n(allow default)\n${rules}\n`, { mode: 0o600 });
  return { executable: '/usr/bin/sandbox-exec', args: ['-f', profile, executable, ...args] };
}
