import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { InstalledSkill } from '../domain/run.ts';

export type SkillFile = { readonly name: string; readonly path: string };

export async function hashInstalled(files: readonly SkillFile[]): Promise<readonly InstalledSkill[]> {
  return Promise.all(
    files.map(async ({ name, path }) => {
      const body = await readFile(path).catch(() => null);
      return { name, contentHash: body === null ? null : `sha256:${createHash('sha256').update(body).digest('hex')}` };
    }),
  );
}

// The shell has no Pi session, so it asks Pi's own resource loader which skills a session in this directory would load.
export async function discoverInstalledSkills(cwd: string): Promise<readonly InstalledSkill[]> {
  const { DefaultResourceLoader, getAgentDir } = await import('@earendil-works/pi-coding-agent');
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  return hashInstalled(loader.getSkills().skills.map((skill) => ({ name: skill.name, path: skill.filePath })));
}

export function parseInstalled(text: string): readonly InstalledSkill[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => {
      const split = item.indexOf('=');
      return split === -1 ? { name: item, contentHash: null } : { name: item.slice(0, split), contentHash: item.slice(split + 1) };
    });
}
