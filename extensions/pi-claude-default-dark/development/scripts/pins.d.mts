export declare const PINS: { claude: string; pi: string };
export declare function binaryVersion(bin: string): string;
export declare function resolvePinnedClaude(options?: { pin?: string; versionOf?: (bin: string) => string; versionsDir?: string }): string;
