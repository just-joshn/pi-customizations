import { buildFamilies } from './build.ts';
import { designFamilies } from './design.ts';
import { investigationFamilies } from './investigation.ts';
import type { Family } from './types.ts';

export const families: Family[] = [...investigationFamilies, ...designFamilies, ...buildFamilies];

export function familyById(id: string): Family {
  const found = families.find((family) => family.id === id);
  if (found === undefined) throw new Error(`unknown family ${id}; known: ${families.map((family) => family.id).join(', ')}`);
  return found;
}
