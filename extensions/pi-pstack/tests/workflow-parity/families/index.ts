import { buildFamilies } from './build.ts';
import { measuredFamilies } from './build-measured.ts';
import { codemodeFamily } from './codemode.ts';
import { concurrencyFamily } from './concurrency.ts';
import { interactionFamily } from './interaction.ts';
import { swarmRuleFamilies } from './rules.ts';
import { skillsFamilies } from './skills.ts';
import { gateFamilies } from './gates.ts';
import { forensicsFamilies } from './forensics.ts';
import { headlessFamilies } from './headless.ts';
import { historyFamilies } from './history.ts';
import { mcpFamilies } from './mcp.ts';
import { metaFamilies } from './meta.ts';
import { opsFamilies } from './ops.ts';
import { verificationFamilies } from './verification.ts';
import { designFamilies } from './design.ts';
import { investigationFamilies } from './investigation.ts';
import type { Family } from './types.ts';

export const families: Family[] = [...investigationFamilies, ...designFamilies, ...buildFamilies, ...measuredFamilies, ...verificationFamilies, ...historyFamilies, ...opsFamilies, ...metaFamilies, ...forensicsFamilies, ...headlessFamilies, ...mcpFamilies, codemodeFamily, concurrencyFamily, interactionFamily, ...gateFamilies, ...swarmRuleFamilies, ...skillsFamilies];

export function familyById(id: string): Family {
  const found = families.find((family) => family.id === id);
  if (found === undefined) throw new Error(`unknown family ${id}; known: ${families.map((family) => family.id).join(', ')}`);
  return found;
}
