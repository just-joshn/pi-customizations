export const bennyDependencies: string[];
export function nativeBennyFiles(): Promise<Record<string, string>>;
export function installBenny(target: string, options?: { packageSource?: string }): Promise<{ enabled: false; files: { path: string; outcome: string }[]; conflicts: string[]; settings: 'created' | 'updated' | 'unchanged' }>;
export function bennyCommitted(target: string, configurationPaths?: string[]): Promise<{ committed: true; revision: string; paths: string[] }>;
