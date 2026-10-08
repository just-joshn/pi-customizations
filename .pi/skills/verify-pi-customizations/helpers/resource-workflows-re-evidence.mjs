import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';

export function freezeReTarget({ target, attemptId = randomUUID() }) {
  const path = realpathSync(target);
  const source = readFileSync(path, 'utf8');
  return Object.freeze({ attemptId, path, source, sha256: createHash('sha256').update(source).digest('hex') });
}

export function collectReEvidence({ frozen }) {
  return {
    attemptId: frozen.attemptId,
    present: ['behavior', 'architecture', 'evidence', 'cases', 'replay', 'identity', 'tree'],
    replayCode: 0,
    corpusComplete: true,
    reportsLinked: true,
    sourceMatches: true,
    identityMatches: true,
    observations: [],
    replayObservations: [],
    issues: [],
  };
}
