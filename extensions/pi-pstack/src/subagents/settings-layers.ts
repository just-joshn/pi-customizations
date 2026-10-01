import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SettingsRoots = Readonly<{ cwd: string; home: string; agentDir: string }>;
export type SettingsLayers = Readonly<{ user: readonly Record<string, unknown>[]; project: readonly Record<string, unknown>[] }>;

async function readObject(path: string): Promise<Record<string, unknown>[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? [parsed as Record<string, unknown>] : [];
  } catch {
    return [];
  }
}

async function readAll(paths: readonly string[]): Promise<Record<string, unknown>[]> {
  return (await Promise.all(paths.map(readObject))).flat();
}

// Ordered lowest to highest precedence, matching Provider CLI's user < project < local layering.
export async function readSettingsLayers({ cwd, home, agentDir }: SettingsRoots): Promise<SettingsLayers> {
  const [user, project] = await Promise.all([
    readAll([join(home, '.claude', 'settings.json'), join(agentDir, 'settings.json')]),
    readAll([join(cwd, '.claude', 'settings.json'), join(cwd, '.pi', 'settings.json'), join(cwd, '.claude', 'settings.local.json')]),
  ]);
  return { user, project };
}
