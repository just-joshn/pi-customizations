export type FilesystemRestriction = { denied: string[]; allowed: string[]; files?: string[]; writeDenied?: string[]; writeAllowed?: string[] };
export function filesystemLaunch(executable: string, args: string[], directory: string, filesystem?: FilesystemRestriction): Promise<{ executable: string; args: string[] }>;
