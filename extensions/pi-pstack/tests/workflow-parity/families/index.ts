import { buildFamilies } from './build.ts';
import { measuredFamilies } from './build-measured.ts';
import { forensicsFamilies } from './forensics.ts';
import { historyFamilies } from './history.ts';
import { metaFamilies } from './meta.ts';
import { opsFamilies } from './ops.ts';
import { verificationFamilies } from './verification.ts';
import { designFamilies } from './design.ts';
import { investigationFamilies } from './investigation.ts';
import { babysitFamilies } from './pr-babysit.ts';
import type { Family } from './types.ts';

export const families: Family[] = [...investigationFamilies, ...designFamilies, ...buildFamilies, ...measuredFamilies, ...verificationFamilies, ...historyFamilies, ...opsFamilies, ...metaFamilies, ...forensicsFamilies, ...babysitFamilies];

export function familyById(id: string): Family {
  const found = families.find((family) => family.id === id);
  if (found === undefined) throw new Error(`unknown family ${id}; known: ${families.map((family) => family.id).join(', ')}`);
  return found;
}
