#!/usr/bin/env node
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
