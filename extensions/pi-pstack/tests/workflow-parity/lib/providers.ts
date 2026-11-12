// A real-model run's sandbox has its own agent directory, so a provider that a Pi package registers (claude-subscription)
// is missing from its model catalog unless that package is loaded there too. The packages are referenced in place, not copied:
// a copy would lose the dependencies the operator's install hoists above the package.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
 * An OAuth access token that expires mid-run is refreshed in the sandbox's copy of auth.json, which rotates the refresh token and
 * leaves the operator's copy holding a revoked one. A run must start with a token that outlasts it.
 */
export function assertOauthOutlastsRun(authFile: string, providers: string[], runMs: number, now = Date.now()): void {
  const auth = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, { type?: string; expires?: number }>;
  for (const provider of providers) {
    const credential = auth[provider];
    if (credential?.type !== 'oauth' || typeof credential.expires !== 'number') continue;
    if (credential.expires - now < runMs) throw new Error(`${provider}'s OAuth access token expires in ${Math.round((credential.expires - now) / 60_000)} min, before this run's ${Math.round(runMs / 60_000)} min ceiling. A refresh inside the sandbox would rotate the operator's refresh token. Use the provider in Pi once to refresh it, then rerun.`);
  }
}
