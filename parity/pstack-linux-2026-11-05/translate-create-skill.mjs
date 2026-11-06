#!/usr/bin/env node
// Builds pi-pstack's create-skill from Cursor's built-in create-skill (the skill pstack sends authoring to) by replacing
// host facts only: the product name, the personal and project skill folders, and the reserved built-in folder. Pi has
// no user Agent Store, so the store paragraph becomes Cursor's own no-store branch. Every substitution must match
// exactly once, so a changed reference fails here instead of drifting silently.
// Usage: translate-create-skill.mjs [<cursor create-skill SKILL.md>] [<output>]
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [source = join(homedir(), '.cursor/skills-cursor/create-skill/SKILL.md'), output = 'extensions/pi-pstack/skills/create-skill/SKILL.md'] = process.argv.slice(2);

const SUBSTITUTIONS = [
  ['product in description', '  Create Cursor Agent Skills. Use when authoring', '  Create Pi Agent Skills. Use when authoring'],
  ['product in title', '# Creating Skills in Cursor\n', '# Creating Skills in Pi\n'],
  ['product in intro', 'effective Agent Skills for Cursor.', 'effective Agent Skills for Pi.'],
  ['target location question', 'personal skill (your user Agent Store) or project skill (.cursor/skills/)?', 'personal skill (~/.pi/agent/skills/) or project skill (.pi/skills/)?'],
  ['AskQuestion options', '["Personal (my user Agent Store)", "Project (.cursor/skills/)"]', '["Personal (~/.pi/agent/skills/)", "Project (.pi/skills/)"]'],
  [
    'storage table',
    '| Personal | `skills/skill-name/` in your user Agent Store | Available in every project, on every machine you sign in on |\n| Project | .cursor/skills/skill-name/ | Shared with anyone using the repository |',
    '| Personal | ~/.pi/agent/skills/skill-name/ | Available in every project on this machine |\n| Project | .pi/skills/skill-name/ | Shared with anyone using the repository |',
  ],
  [
    'no user store: Cursor CLI branch',
    '**Personal skills live in your user Agent Store, not in `~/.cursor/skills/`.** Write them to `skills/<skill-name>/SKILL.md` under the user store path listed in the "Available persistent agent stores" section of your context — for example `/cursor/stores/user/skills/<skill-name>/SKILL.md` when that is the advertised path. Use the normal file tools; the store syncs from there.\n\nIf no user store is listed in your context, that store is not mounted for this run. Write the skill to `~/.cursor/skills/skill-name/` instead and tell the user it landed on this machine only.',
    'Pi has no user Agent Store, so no store is mounted for this run. Write the skill to `~/.pi/agent/skills/skill-name/` (`$PI_CODING_AGENT_DIR/skills/skill-name/` when that variable is set) and tell the user it landed on this machine only.',
  ],
  [
    'reserved built-in folder',
    "**IMPORTANT**: Never create skills in `~/.cursor/skills-cursor/`. This directory is reserved for Cursor's internal built-in skills and is managed automatically by the system.",
    "**IMPORTANT**: Never create skills inside an installed Pi package, such as pi-pstack's `skills/` directory. Those directories hold the package's own skills and are managed automatically by `pi install` and `pi update`.",
  ],
];

let text = readFileSync(source, 'utf8');
for (const [name, from, to] of SUBSTITUTIONS) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${name}: expected one match, found ${count}`);
  text = text.replace(from, to);
}
const leftover = text.split('\n').filter((line) => /cursor/i.test(line));
if (leftover.length > 0) throw new Error(`Cursor-specific text left:\n${leftover.join('\n')}`);
writeFileSync(output, text);
console.log(`wrote ${output} from ${source}: ${SUBSTITUTIONS.length} substitutions`);
