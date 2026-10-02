export type Problem = Readonly<{ rule: string; path: string; advice: string }>;
export function scan(root?: string): readonly Problem[];
export function undocumentedExceptions(root?: string): readonly Problem[];
