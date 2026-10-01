import { deliveredNote, type HandbackOutcome, type HandbackReport, type HandbackState, waitingNote, withheldNote } from './handback.ts';
import { capResultText } from './limits.ts';
import { type Finding, frameReport, handbackProvenance, sanitizeReport, sectionHash, type TextBlock } from './output-trust.ts';

export const oneShotAgentTypes: ReadonlySet<string> = new Set(['Explore', 'Plan']);
const turnLimitPrefix = 'NOTE: this agent stopped at its ';

export type FinalizeInput = Readonly<{ output: string; agentType: string; sender: string; maxTurnsReached?: number; handback?: HandbackState }>;
export type FinalizedReport = Readonly<{
  content: TextBlock[];
  harnessNoteCount: number;
  harnessTailCount: number;
  harnessSectionHash: string;
  findings: readonly Finding[];
  handback?: HandbackOutcome;
  handbackReport?: HandbackReport;
}>;

function turnLimitNote(maxTurns: number, hasReport: boolean, agentType: string): TextBlock {
  const partial = hasReport ? 'The text below is PARTIAL output; treat it as incomplete.' : 'It was still calling tools and had produced no report.';
  const resume = oneShotAgentTypes.has(agentType) ? '' : ' Send the agent a message (SendMessage) to let it continue from where it stopped.';
  return { type: 'text', text: `${turnLimitPrefix}${maxTurns}-turn limit before finishing. ${partial}${resume}\n` };
}

function reportBlocks(input: FinalizeInput): TextBlock[] {
  return input.output && !input.handback ? [{ type: 'text', text: capResultText(input.output) }] : [];
}

function harnessNotes(input: FinalizeInput, report: readonly TextBlock[]): TextBlock[] {
  const notes = input.maxTurnsReached ? [turnLimitNote(input.maxTurnsReached, report.length > 0, input.agentType)] : [];
  const handback = input.handback;
  if (!handback) return notes;
  const note = handback.delivered ? deliveredNote(handback.flagged, input.sender) : handback.waitingOnBackground ? waitingNote : withheldNote(!oneShotAgentTypes.has(input.agentType));
  return [...notes, { type: 'text', text: note }];
}

export function finalizeReport(input: FinalizeInput): FinalizedReport {
  const report = reportBlocks(input);
  const notes = harnessNotes(input, report);
  const sanitized = sanitizeReport(report, { provenance: handbackProvenance() });
  const marked = sanitized.content.length > report.length;
  const content = [...notes, ...sanitized.content];
  return {
    content,
    harnessNoteCount: notes.length + (marked ? 1 : 0),
    harnessTailCount: 0,
    harnessSectionHash: sectionHash(content),
    findings: sanitized.findings,
    ...(input.handback ? { handback: input.handback.delivered ? (input.handback.flagged ? 'flagged' : 'send') : 'withheld' } : {}),
    ...(input.handback?.report ? { handbackReport: input.handback.report } : {}),
  };
}

export function modelFacingReport(report: Pick<FinalizedReport, 'content' | 'harnessNoteCount' | 'harnessTailCount' | 'harnessSectionHash'>): string {
  const blocks = report.content.length ? report.content : [{ type: 'text' as const, text: '(Subagent completed but returned no output.)' }];
  if (!handbackProvenance()) return blocks.map((block) => block.text).join('\n');
  const counted = report.content.length > 0;
  return frameReport(blocks, counted ? report.harnessNoteCount : 0, counted ? report.harnessTailCount : 0, report.harnessSectionHash);
}
