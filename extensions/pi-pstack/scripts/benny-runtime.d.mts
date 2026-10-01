import type { IssueEligibility, SourceThread, VerdictMarkers } from './benny-domain.mjs';
export type BennyIssueDraft = { title: string; eligibility: IssueEligibility };
export type BennyDeliveryAdapter = {
  verdictMarkers?: VerdictMarkers;
  parent(source: SourceThread): Promise<SourceThread & { exists: boolean; verdictExists?: boolean }>;
  createIssue(draft: BennyIssueDraft): Promise<string>;
  reply(source: SourceThread, text: string, issue?: string): Promise<string>;
  verifyReply(source: SourceThread, reply: string): Promise<boolean>;
  compensate(issue: string): Promise<void>;
  verifyCompensation(issue: string): Promise<boolean>;
};
export function deliverVerdict(source: SourceThread, adapter: BennyDeliveryAdapter, text: string, draft?: BennyIssueDraft): Promise<{ kind: string; reply?: string; issue?: string }>;
