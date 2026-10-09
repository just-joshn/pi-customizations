import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const router = 'poteto-mode';
const help = 'poteto-help';
const workflow = new Set(['how', 'why', 'arena', 'architect', 'interrogate', 'swarm', 'reflect', 'figure-it-out', 'recall', 'teach', 'blast-radius', 'thermo-nuclear-code-quality-review']);
const layerOf = (name: string) => (name === help ? 4 : name === router ? 3 : name.startsWith('principle-') ? 0 : workflow.has(name) ? 2 : 1);

/**
 * The reference document names four layering exceptions and calls them small and deliberate. The rest come from the
 * ported team-kit skills. Each pair is a working cross-reference, so the port pins the set instead of rewriting prose
 * that carries behavior. A new upward or cyclic reference fails this test.
 */
const documented = new Map([
  ['automate-me -> poteto-mode', 'the personal-mode authoring skill reads the router for the shape and granularity'],
  ['control-ui -> verify-this', 'driving a UI produces the before-and-after evidence verify-this asks for'],
  ['verify-this -> control-ui', 'the same companion edge, read from the proof skill'],
  ['create-verification-skill -> maintain-verification-skill', 'the pair is generated and maintained as companions'],
  ['maintain-verification-skill -> create-verification-skill', 'the same companion edge, read from the upkeep skill'],
  ['figure-it-out -> poteto-mode', 'the first todo reads the principles index before the run is designed'],
  ['no-comments -> architect', 'an accepted comment fix that needs a shape gets one architect pass'],
  ['no-comments -> how', 'a thin comment claim is investigated before the comment is judged'],
  ['no-comments -> why', 'the same investigation edge for a provenance claim'],
  ['principle-explain-the-number -> benchmark-checklist', 'the measurement principle names the procedure that tests a performance claim'],
  ['principle-prove-it-works -> show-me-your-work', 'the principle names the trail a large run commits'],
  ['principle-type-system-discipline -> typescript-best-practices', 'the leaf names the craft skill that grounds it in syntax'],
]);

async function generatedSkills(): Promise<readonly string[]> {
  const entries = await readdir(join(root, 'skills'));
  const present = await Promise.all(entries.map(async (name) => ((await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8').catch(() => undefined)) === undefined ? undefined : name)));
  return present.filter((name): name is string => name !== undefined);
}

function referencesSkill(text: string, candidate: string): boolean {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [`\`${escaped}\``, `\\*\\*${escaped}\\*\\*`, `(^|[^\\w-])/${escaped}\\b`].some((pattern) => new RegExp(pattern).test(text));
}

test('every upward or cyclic skill reference is one the reference document documents', async () => {
  const skills = await generatedSkills();
  const sources = skills.filter((name) => name !== router);
  const bodies = new Map(await Promise.all(skills.map(async (name) => [name, await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8')] as const)));
  const edges = new Set<string>();
  for (const from of sources) {
    const text = bodies.get(from) ?? '';
    for (const to of skills) {
      if (from === to || !referencesSkill(text, to)) continue;
      const upward = layerOf(to) > layerOf(from);
      const cyclic = layerOf(to) === layerOf(from) && referencesSkill(bodies.get(to) ?? '', from);
      if (upward || cyclic) edges.add(`${from} -> ${to}`);
    }
  }
  expect([...edges].toSorted()).toEqual([...documented.keys()].toSorted());
});
