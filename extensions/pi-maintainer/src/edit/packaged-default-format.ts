import type { EditFormatName } from '../feature.ts';
import type { PhysicalModelRef } from './model-switch.ts';

/**
 * Packaged default edit format for a physical model identity.
 * Unrecognized-name heuristics stay in `edit.model.format-policy` (pm/model-format-policy).
 * Command switch only needs a stable packaged lookup for persistence comparisons.
 */
export function packagedDefaultEditFormat(_model: PhysicalModelRef | null): EditFormatName {
  return 'whole';
}
