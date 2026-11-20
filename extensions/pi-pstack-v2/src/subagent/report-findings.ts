import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { StringEnum } from '@earendil-works/pi-ai';
import type { Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { type Static, Type } from 'typebox';
import { z } from 'zod';

export const REPORT_FINDINGS_TOOL = 'report_findings';
const MAX_FINDINGS = 32;
const MAX_SHORT_SUMMARY = 60;
const MIN_TEXT = 1;
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const VERDICTS = ['CONFIRMED', 'PLAUSIBLE'] as const;
const OUTCOMES = ['fixed', 'skipped', 'no_change_needed'] as const;

const FindingParam = Type.Object({
  file: Type.String({ minLength: MIN_TEXT, description: 'File the finding is in.' }),
  line: Type.Optional(Type.Integer({ minimum: 1, description: 'Line in the file.' })),
  summary: Type.String({ minLength: MIN_TEXT, description: 'What is wrong.' }),
  short_summary: Type.Optional(Type.String({ maxLength: MAX_SHORT_SUMMARY, description: `One-line title, at most ${MAX_SHORT_SUMMARY} characters.` })),
  failure_scenario: Type.String({ minLength: MIN_TEXT, description: 'How the problem shows up.' }),
  category: Type.Optional(Type.String({ description: 'Kind of problem.' })),
  verdict: Type.Optional(StringEnum(VERDICTS, { description: 'How sure the finding is.' })),
  outcome: Type.Optional(StringEnum(OUTCOMES, { description: 'What was done about it.' })),
});

export const ReportFindingsParams = Type.Object({
  level: Type.Optional(StringEnum(LEVELS, { description: 'Review depth the findings come from.' })),
  findings: Type.Array(FindingParam, { maxItems: MAX_FINDINGS, description: 'The findings. Empty when there are none.' }),
});

const FindingSchema = z.object({
  file: z.string().min(MIN_TEXT),
  line: z.number().int().positive().optional(),
  summary: z.string().min(MIN_TEXT),
  short_summary: z.string().max(MAX_SHORT_SUMMARY).optional(),
  failure_scenario: z.string().min(MIN_TEXT),
  category: z.string().optional(),
  verdict: z.enum(VERDICTS).optional(),
  outcome: z.enum(OUTCOMES).optional(),
});

export const ReportFindingsParamsSchema = z.object({
  level: z.enum(LEVELS).optional(),
  findings: z.array(FindingSchema).max(MAX_FINDINGS),
});

export type ReportFindingsInput = Static<typeof ReportFindingsParams>;
export type ReportFindingsDetails = z.infer<typeof ReportFindingsParamsSchema>;
type Finding = ReportFindingsDetails['findings'][number];

export function reportFindings(params: unknown): AgentToolResult<ReportFindingsDetails> {
  const details = ReportFindingsParamsSchema.parse(params);
  const text = details.findings.length === 0 ? 'No findings reported.' : `${details.findings.length} finding(s) reported.`;
  return { content: [{ type: 'text', text }], details };
}

const findingLine = (theme: Theme, finding: Finding): string => {
  const verdict = finding.verdict ? `${theme.fg(finding.verdict === 'CONFIRMED' ? 'error' : 'warning', `[${finding.verdict}]`)} ` : '';
  const place = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
  return `  ${verdict}${theme.fg('accent', place)} ${finding.short_summary || finding.summary}`;
};

const headline = (theme: Theme, count: number, level: string | undefined): string => theme.fg('toolTitle', theme.bold('report_findings ')) + theme.fg('accent', `${count} finding(s)`) + (level ? theme.fg('muted', ` [${level}]`) : '');

const parseInput = (args: unknown): ReportFindingsDetails => {
  const parsed = ReportFindingsParamsSchema.safeParse(args);
  return parsed.success ? parsed.data : { findings: [] };
};

export function renderReportFindingsCall(args: unknown, theme: Theme): Text {
  const { level, findings } = parseInput(args);
  return new Text(headline(theme, findings.length, level), 0, 0);
}

export function renderReportFindingsResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): Text {
  const parsed = ReportFindingsParamsSchema.safeParse(result.details);
  if (!parsed.success) return new Text(theme.fg('muted', 'No findings reported.'), 0, 0);
  const { level, findings } = parsed.data;
  if (findings.length === 0) return new Text(theme.fg('muted', 'No findings reported.'), 0, 0);
  const rows = findings.map((finding) => findingLine(theme, finding));
  const detail = expanded ? findings.flatMap((finding, index) => [rows[index] ?? '', `    ${theme.fg('dim', `Failure: ${finding.failure_scenario}`)}`]) : rows;
  return new Text([headline(theme, findings.length, level), ...detail].join('\n'), 0, 0);
}
