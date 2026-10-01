export interface ClauseCheck {
  type: string;
  path?: string;
  quote?: string;
  name?: string;
  rev?: string;
  runner?: string;
}
export interface Clause {
  id: string;
  lines: number[];
  requirement: string;
  kind: string;
  verdict: string;
  runtime?: boolean;
  checks?: ClauseCheck[];
  note?: string;
}
export interface SliceRange {
  id: string;
  from: number;
  to: number;
}
export function isUnresolved(clause: Pick<Clause, 'verdict'>): boolean;
export function contentLines(text: string): number[];
export function auditClause(clause: unknown, range: SliceRange): string[];
export function auditSlice(slice: SliceRange, clauses: Clause[], covered: number[]): string[];
export function reusedQuotes(clauses: Clause[], limit: number): string[];
export function normalize(text: string): string;
