export interface BiomeDiagnostic {
  category: string;
  message: string;
  location?: { path?: string; start?: { line?: number; column?: number }; end?: { line?: number; column?: number } };
}
export interface LintIdentity {
  file: string;
  category: string;
  message: string;
  hash: string;
  preview: string;
  count: number;
  at: string[];
}
export interface BaselineEntry {
  file: string;
  category: string;
  message: string;
  hash: string;
  count: number;
}
export const SCOPE: string;
export const BASELINE: string;
export function identities(diagnostics: BiomeDiagnostic[], readSource: (file: string) => string): Map<string, LintIdentity>;
export function compare(baselineEntries: BaselineEntry[], current: Map<string, LintIdentity>): { added: (LintIdentity & { extra: number })[]; removed: string[] };
export function serialize(biomeVersion: string, current: Map<string, LintIdentity>): string;
export function runBiome(root: string, biome?: string): unknown;
