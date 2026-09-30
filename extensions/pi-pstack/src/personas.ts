import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
type Persona = Readonly<{ files: readonly string[]; text?: string; defaultModel?: string }>;
const shell =
  'You are a shell agent. Run the requested terminal commands with bash and report the exact command, exit status, and relevant output. Do not edit files unless the task says so. Never run destructive commands the task did not name.';
const explore = 'You are a read-only codebase explorer. Answer with file paths and line references. Search with rg, find, and read. Never modify files. Report what you found, what you could not find, and what you inferred.';
const comment = { files: ['upstream/agents/comment-sicko.md'] };
const personas = new Map<string, Persona>([
  ['generalPurpose', { files: [] }],
  ['shell', { files: [], text: shell }],
  ['explore', { files: [], text: explore }],
  ['poteto-agent', { files: ['upstream/agents/poteto-agent.md', 'skills/poteto-mode/SKILL.md'] }],
  ['comment-sicko', comment],
  ['Comment Sicko', comment],
  ['ci-watcher', { files: ['upstream-team-kit/agents/ci-watcher.md'] }],
  ['thermo-nuclear-code-quality-review', { files: ['upstream-team-kit/agents/thermo-nuclear-code-quality-review.md', 'skills/thermo-nuclear-code-quality-review/SKILL.md'] }],
]);

export async function readPersona(name: string): Promise<{ instructions: string; defaultModel: string | undefined }> {
  const persona = personas.get(name);
  if (!persona) throw new Error(`Unsupported agent ${name}. Available: ${[...personas.keys()].join(', ')}`);
  const bodies = await Promise.all(persona.files.map((file) => readFile(join(root, file), 'utf8')));
  return { instructions: [...(persona.text ? [persona.text] : []), ...bodies].join('\n'), defaultModel: persona.defaultModel };
}
