#!/usr/bin/env node
/**
 * The bridge from a legacy scenario to the F-014 whole-row observations.
 *
 * A legacy receipt asserts one clause of its row. This drives the composite
 * session once per scenario into a dedicated `composite/` subdirectory of the
 * raw captures, then hands each receipt the matching whole-row result so the
 * receipt can require it beside its own clause. The subdirectory keeps the
 * composite capture names from overwriting the legacy ones.
 */
import { join } from 'node:path';

import { COMPOSITE_CHECKS } from '../pi-tui-skin-composite.mjs';
import { runCompositeSession } from './pi-tui-skin-composite-drive.mjs';

export function runCompositeClosure({ repoRoot, rawDir }) {
  const dir = join(rawDir, 'composite');
  const observations = runCompositeSession({ repoRoot, rawDir: dir });
  const results = new Map(COMPOSITE_CHECKS.map((check) => [check.surfaceId, check.run(observations)]));
  return {
    dir,
    result(surfaceId) {
      const result = results.get(surfaceId);
      if (result === undefined) throw new Error(`no composite observation for ${surfaceId}`);
      return result;
    },
  };
}
