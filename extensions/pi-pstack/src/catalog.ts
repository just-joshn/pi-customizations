import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function names(directory: string, suffix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => (suffix ? entry.isFile() && entry.name.endsWith(suffix) : entry.isDirectory()))
    .map((entry) => entry.name.slice(0, entry.name.length - suffix.length))
    .toSorted();
}

export async function skillCatalog(root: string): Promise<string> {
  const skills = join(root, 'skills');
  const host = join(root, 'host/skills');
  const playbooks = join(skills, 'poteto-mode/playbooks');
  const [skillNames, hostNames, playbookNames] = await Promise.all([names(skills), names(host), names(playbooks, '.md')]);
  return [
    `A workflow that names a skill, such as "the how skill", "/deslop", or a principle such as Prove It Works (principle-prove-it-works), means the file ${skills}/<name>/SKILL.md. Read it in full before applying it and resolve its references relative to its directory. Skills: ${skillNames.join(', ')}.`,
    `Host skills live at ${host}/<name>/SKILL.md: ${hostNames.join(', ')}.`,
    `Playbooks live at ${playbooks}/<name>.md: ${playbookNames.join(', ')}.`,
  ].join('\n');
}
