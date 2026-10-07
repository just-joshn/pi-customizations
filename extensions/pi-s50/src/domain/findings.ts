export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type FindingStatus = 'open' | 'resolved' | 'dismissed';

export type Finding = {
  readonly id: string;
  readonly severity: Severity;
  readonly trigger: string;
  readonly consequence: string;
  readonly evidence: string;
  readonly revision: string;
  readonly owner: string;
  readonly status: FindingStatus;
  readonly reviewer: string;
  readonly guidelines: { readonly contentHash: string; readonly skillLock: string } | null;
};
