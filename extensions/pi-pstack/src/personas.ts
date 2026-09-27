import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

const root = fileURLToPath(new URL('../', import.meta.url));
type Persona = Readonly<{ files: readonly string[]; defaultModel?: string }>;
const comment = { files: ['upstream/agents/comment-sicko.md'] };
const personas = new Map<string, Persona>([
  ['generalPurpose', { files: [] }],
  ['poteto-agent', { files: ['upstream/agents/poteto-agent.md', 'skills/poteto-mode/SKILL.md'] }],
  ['comment-sicko', comment],
  ['Comment Sicko', comment],
  ['ci-watcher', { files: ['upstream-team-kit/agents/ci-watcher.md'], defaultModel: 'fast' }],
  ['thermo-nuclear-code-quality-review', { files: [
    'upstream-team-kit/agents/thermo-nuclear-code-quality-review.md',
    'skills/thermo-nuclear-code-quality-review/SKILL.md',
  ] }],
]);

export async function readPersona(name: string): Promise<{ instructions: string; defaultModel: string | undefined }> {
  const persona = personas.get(name);
  if (!persona) throw new Error(`Unsupported agent ${name}. Cursor built-in roles such as shell and explore are not supplied. Available: ${[...personas.keys()].join(', ')}`);
  const bodies = await Promise.all(persona.files.map(file => readFile(join(root, file), 'utf8')));
  return { instructions: bodies.join('\n'), defaultModel: persona.defaultModel };
}

export async function readTeamKitRules(): Promise<string> {
  const files = ['no-inline-imports.mdc', 'typescript-exhaustive-switch.mdc'];
  const rules = await Promise.all(files.map(async file => parseFrontmatter(await readFile(join(root, 'upstream-team-kit/rules', file), 'utf8')).body));
  return rules.join('\n\n');
}
