import { capResultText } from './limits.ts';
import { type Finding, frameReport, handbackProvenance, sanitizeReport, sectionHash, type TextBlock } from './output-trust.ts';

const turnLimitPrefix = 'NOTE: this agent stopped at its ';

export type FinalizeInput = Readonly<{ output: string; agentType: string; sender: string; maxTurnsReached?: number }>;
export type FinalizedReport = Readonly<{
  content: TextBlock[];
  harnessNoteCount: number;
  harnessTailCount: number;
  harnessSectionHash: string;
  findings: readonly Finding[];
}>;

function turnLimitNote(maxTurns: number, hasReport: boolean): TextBlock {
  const partial = hasReport ? 'The text below is PARTIAL output; treat it as incomplete.' : 'It was still calling tools and had produced no report.';
  return { type: 'text', text: `${turnLimitPrefix}${maxTurns}-turn limit before finishing. ${partial}\n` };
}

function reportBlocks(input: FinalizeInput): TextBlock[] {
  return input.output ? [{ type: 'text', text: capResultText(input.output) }] : [];
}

function harnessNotes(input: FinalizeInput, report: readonly TextBlock[]): TextBlock[] {
  return input.maxTurnsReached ? [turnLimitNote(input.maxTurnsReached, report.length > 0)] : [];
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
  };
}

export function modelFacingReport(report: Pick<FinalizedReport, 'content' | 'harnessNoteCount' | 'harnessTailCount' | 'harnessSectionHash'>): string {
  const blocks = report.content.length ? report.content : [{ type: 'text' as const, text: '(Subagent completed but returned no output.)' }];
  if (!handbackProvenance()) return blocks.map((block) => block.text).join('\n');
  const counted = report.content.length > 0;
  return frameReport(blocks, counted ? report.harnessNoteCount : 0, counted ? report.harnessTailCount : 0, report.harnessSectionHash);
}
