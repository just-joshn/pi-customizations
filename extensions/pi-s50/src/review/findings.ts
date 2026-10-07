import { createHash } from 'node:crypto';

import type { Finding, FindingStatus } from '../domain/findings.ts';

export type FindingInput = Omit<Finding, 'id' | 'status' | 'revision' | 'guidelines'>;

export function createFinding(input: FindingInput, guidelines: Finding['guidelines'], id: string, revision: string): Finding {
  return { ...input, guidelines, id, revision, status: 'open' };
}

export function sameFinding(a: Finding, b: Finding): boolean {
  return a.severity === b.severity && a.trigger === b.trigger && a.consequence === b.consequence && a.evidence === b.evidence && a.revision === b.revision && a.owner === b.owner && a.reviewer === b.reviewer;
}

export function resolveFinding(finding: Finding, resolution: Exclude<FindingStatus, 'open'>): Finding {
  return { ...finding, status: resolution };
}

export function captureGuidelines(content: string, skillLock: string): NonNullable<Finding['guidelines']> {
  return { contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`, skillLock };
}
