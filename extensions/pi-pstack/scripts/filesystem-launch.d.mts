export type FilesystemRestriction = { denied: string[]; allowed: string[] };
export function filesystemLaunch(executable: string, args: string[], directory: string, filesystem?: FilesystemRestriction): Promise<{ executable: string; args: string[] }>;
