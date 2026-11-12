// A real-model run's sandbox has its own agent directory, so a provider that a Pi package registers (claude-subscription)
// is missing from its model catalog unless that package is loaded there too. The packages are referenced in place, not copied:
// a copy would lose the dependencies the operator's install hoists above the package.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const operatorAgentDir = () => process.env['PSTACK_E2E_AGENT_DIR'] ?? join(process.env['HOME'] ?? '', '.pi', 'agent');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|js|mjs)$/.test(name) ? [path] : [];
  });
}

/** The operator's installed Pi packages that declare a Pi extension naming `provider` in their source. */
export function packagesRegistering(provider: string, agentDir = operatorAgentDir()): string[] {
  const settingsPath = join(agentDir, 'settings.json');
  if (!existsSync(settingsPath)) return [];
  const sources = ((JSON.parse(readFileSync(settingsPath, 'utf8')) as { packages?: unknown }).packages ?? []) as unknown[];
  const quoted = new RegExp(`['"\`]${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  return sources.flatMap((source) => {
    if (typeof source !== 'string' || !source.startsWith('npm:')) return [];
    const dir = join(agentDir, 'npm', 'node_modules', source.slice('npm:'.length));
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest) || (JSON.parse(readFileSync(manifest, 'utf8')) as { pi?: unknown }).pi === undefined) return [];
    return existsSync(join(dir, 'src')) && sourceFiles(join(dir, 'src')).some((file) => quoted.test(readFileSync(file, 'utf8'))) ? [dir] : [];
  });
}

/** A package that registers a provider the sandbox's models name, and the providers this run needs from outside Pi's built-ins. */
export function providerOf(model: string): string {
  return model.split('/')[0] ?? '';
}

/**
 * The sandbox must never refresh an OAuth credential: a refresh rotates the refresh token and leaves the operator's copy revoked.
 * Its copy of auth.json keeps only the access token, so a token that expires mid-run fails that run instead of refreshing.
 */
export function withoutOauthRefresh(authFile: string): void {
  const auth = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, { type?: string; refresh?: string }>;
  for (const credential of Object.values(auth)) if (credential?.type === 'oauth') credential.refresh = '';
  writeFileSync(authFile, JSON.stringify(auth, null, 2), { mode: 0o600 });
}
