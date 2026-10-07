import type { EvidenceRecord } from '../domain/evidence.ts';
import type { Clock } from '../orchestrator/clock.ts';

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index] ?? '';
    if (char === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function matches(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

export function latestByClaim(evidence: readonly EvidenceRecord[]): readonly EvidenceRecord[] {
  const latest = new Map<string, EvidenceRecord>();
  for (const record of evidence) latest.set(record.claim, record);
  return [...latest.values()];
}

export function isAffected(record: EvidenceRecord, changedPaths: readonly string[]): boolean {
  return record.dependencies.some((glob) => changedPaths.some((path) => matches(glob, path)));
}

export function invalidate(evidence: readonly EvidenceRecord[], changedPaths: readonly string[], revision: string, clock: Clock): readonly EvidenceRecord[] {
  const appended = latestByClaim(evidence).flatMap((record): EvidenceRecord[] => {
    if (record.state === 'STALE' || record.revision === revision) return [];
    const base = { ...record, id: clock.id('ev'), recordedAt: clock.now(), supersedes: record.id };
    if (isAffected(record, changedPaths)) return [{ ...base, state: 'STALE', observed: `stale: dependency changed before ${revision}` }];
    return [{ ...base, revision }];
  });
  return [...evidence, ...appended];
}
