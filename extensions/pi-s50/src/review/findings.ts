import { createHash } from 'node:crypto';

import type { Finding, FindingStatus } from '../domain/findings.ts';
import { redact } from '../evidence/verification.ts';

export type FindingInput = Omit<Finding, 'id' | 'status' | 'revision'>;

export function createFinding(input: FindingInput, id: string, revision: string): Finding {
  return {
    ...input,
    id,
    revision,
    status: 'open',
    trigger: redact(input.trigger),
    consequence: redact(input.consequence),
    evidence: redact(input.evidence),
    owner: redact(input.owner),
    reviewer: redact(input.reviewer),
  };
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
