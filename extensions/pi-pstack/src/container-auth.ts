// What a container worker needs to talk to its model provider: the provider's own stored credential, and the installed Pi
// packages that register the provider. Runs in the parent, never in the worker host bundle.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** A worker shorter-lived than this is refused: Pi refreshes an OAuth token inside the last 5 minutes, and the container cannot. */
export const MIN_OAUTH_LIFETIME_MS = 10 * 60_000;

export class ProviderAuthUnavailableError extends Error {
  constructor(reason: string) {
    super(`ProviderAuthUnavailable: ${reason}`);
    this.name = 'ProviderAuthUnavailable';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The agent directory a Pi started with this environment uses: PI_CODING_AGENT_DIR, else `~/.pi/agent`. */
export function agentDirOf(env: Readonly<Record<string, string | undefined>>): string {
  const home = env['HOME'] ?? homedir();
  const configured = env['PI_CODING_AGENT_DIR'];
  return configured ? configured.replace(/^~(?=$|\/)/, home) : join(home, '.pi', 'agent');
}

type Stored = { type: 'api_key'; key: string | undefined } | { type: 'oauth'; access: string; refresh: string; expires: number };

function readStored(agentDir: string, provider: string): Stored | undefined {
  const path = join(agentDir, 'auth.json');
  if (!existsSync(path)) return undefined;
  let all: unknown;
  try {
    all = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ProviderAuthUnavailableError(`${path} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  const entry = isRecord(all) ? all[provider] : undefined;
  if (entry === undefined) return undefined;
  if (isRecord(entry) && entry['type'] === 'api_key' && (entry['key'] === undefined || typeof entry['key'] === 'string')) return { type: 'api_key', key: entry['key'] as string | undefined };
  if (isRecord(entry) && entry['type'] === 'oauth' && typeof entry['access'] === 'string' && typeof entry['refresh'] === 'string' && typeof entry['expires'] === 'number')
    return { type: 'oauth', access: entry['access'], refresh: entry['refresh'], expires: entry['expires'] };
  throw new ProviderAuthUnavailableError(`${path} holds a credential for ${provider} that is neither an api_key nor an oauth credential`);
}

/** Pi resolves a stored key that starts with `!` as a command and one that has `$` as an environment template. Only Pi itself should do either. */
const isLiteral = (key: string): boolean => !key.startsWith('!') && !key.includes('$');

export interface PackageSet {
  /** Package directories (and the dependencies they resolve outside themselves) to mount read-only at the same path. */
  mounts: string[];
  /** Extension entry files, at the same paths, to pass as `--extension`. */
  extensions: string[];
}

function packageEntries(dir: string): string[] {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return [];
  const pi = (JSON.parse(readFileSync(manifest, 'utf8')) as { pi?: { extensions?: unknown } }).pi;
  const listed = Array.isArray(pi?.extensions) ? pi.extensions.filter((entry): entry is string => typeof entry === 'string') : [];
  return listed.flatMap((entry) => {
    const path = resolve(dir, entry);
    if (!existsSync(path)) return [];
    if (statSync(path).isDirectory()) return ['index.ts', 'index.js'].map((name) => join(path, name)).filter(existsSync).slice(0, 1);
    return [path];
  });
}

const SOURCE_FILE = /\.(?:ts|mts|js|mjs)$/;
const SKIPPED_DIRECTORY = /^(?:node_modules|\..*|dist|tests?|__tests__)$/;

/** The text of a package's source files, bounded: enough to tell whether it registers a provider. */
function packageSource(dir: string): string {
  const parts: string[] = [];
  let files = 0;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (files >= 400) return;
      const path = join(current, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORY.test(entry.name)) walk(path);
      else if (entry.isFile() && SOURCE_FILE.test(entry.name) && statSync(path).size <= 1 << 20) {
        files += 1;
        parts.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(dir);
  return parts.join('\n');
}

const registers = (dir: string, provider: string): boolean => {
  const source = packageSource(dir);
  return /registerProvider\s*\(/.test(source) && [`'${provider}'`, `"${provider}"`, `\`${provider}\``].some((quoted) => source.includes(quoted));
};

/** Where `npm:` and local-path sources in a settings file resolve to. Git sources are not installed under a path pstack can know, so they are left out. */
function packageDirs(settingsDir: string, base: string): string[] {
  const settings = join(settingsDir, 'settings.json');
  if (!existsSync(settings)) return [];
  let packages: unknown;
  try {
    packages = (JSON.parse(readFileSync(settings, 'utf8')) as { packages?: unknown }).packages;
  } catch {
    return [];
  }
  if (!Array.isArray(packages)) return [];
  return packages.flatMap((spec): string[] => {
    const source = typeof spec === 'string' ? spec : isRecord(spec) && typeof spec['source'] === 'string' ? spec['source'] : undefined;
    if (source === undefined) return [];
    const npm = /^npm:(@[^/@]+\/[^@/]+|[^@/]+)(?:@.+)?$/.exec(source)?.[1];
    if (npm !== undefined) return [join(base, 'npm', 'node_modules', npm)];
    if (/^(?:\/|\.\.?\/|~\/)/.test(source)) return [resolve(settingsDir, source.replace(/^~(?=\/)/, homedir()))];
    return [];
  });
}

/** Directories a package's `dependencies` resolve to outside the package itself, with theirs, so a hoisted install still loads. */
function dependencyDirs(dir: string, seen = new Set<string>()): string[] {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest) || seen.size > 200) return [];
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  const found: string[] = [];
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    for (let at = dir; ; at = dirname(at)) {
      const candidate = join(at, 'node_modules', name);
      if (existsSync(candidate)) {
        const real = realpathSync(candidate);
        if (!seen.has(real) && relative(dir, real).startsWith('..')) {
          seen.add(real);
          found.push(real, ...dependencyDirs(real, seen));
        }
        break;
      }
      if (dirname(at) === at) break;
    }
  }
  return found;
}

function toPackageSet(dirs: readonly string[]): PackageSet {
  const real = [...new Set(dirs.filter(existsSync).map((dir) => realpathSync(dir)))];
  return { mounts: [...new Set(real.flatMap((dir) => [dir, ...dependencyDirs(dir)]))], extensions: real.flatMap(packageEntries) };
}

/**
 * The installed Pi packages that register `provider`: the ones in the user's and the project's `settings.json` whose source
 * calls registerProvider and names the provider. `explicit` (SpawnOptions or PSTACK_CONTAINER_PROVIDER_PACKAGES) replaces the search.
 */
export function findProviderPackages(provider: string, agentDir: string, projectRoot: string, explicit: readonly string[] = []): PackageSet {
  if (explicit.length > 0) return toPackageSet(explicit);
  const candidates = [...packageDirs(agentDir, agentDir), ...packageDirs(join(projectRoot, '.pi'), join(projectRoot, '.pi'))].filter((dir) => existsSync(dir) && registers(dir, provider));
  return toPackageSet(candidates);
}

export interface ContainerAuth {
  /** The container's whole auth.json, holding this provider's credential and no other. Null when nothing is stored for the provider. */
  authJson: string | null;
  kind: 'api_key' | 'oauth' | 'none';
  /** An OAuth access token's expiry, epoch milliseconds. */
  expiresAt: number | null;
  packages: PackageSet;
}

export interface AuthRequest {
  provider: string;
  source: Readonly<Record<string, string | undefined>>;
  projectRoot: string;
  /** Provider ids Pi has built in: they need no package. */
  builtin: ReadonlySet<string>;
  /**
   * Has Pi resolve the provider's credential now, which refreshes an OAuth token near expiry and resolves a key that is a
   * command or an environment template. The parent's own model registry does that; without one, only a literal key or a token
   * with enough life left can be handed over.
   */
  resolve?: (provider: string) => Promise<unknown>;
  packages?: readonly string[];
  minOAuthValidityMs?: number;
  now?: () => number;
}

/**
 * What a container worker gets so its model provider works: only `provider`'s credential, as a new auth.json, and the
 * package(s) that register it. An OAuth credential goes without its refresh token. The container could never refresh it
 * without rotating the host's copy, which would log the operator out, so it gets the access token and an empty refresh token.
 * The host refreshes first when the token is near expiry. When the token expires inside the container, Pi's refresh fails
 * there (see MIN_OAUTH_LIFETIME_MS) and the worker's next model call errors.
 */
export async function prepareContainerAuth(request: AuthRequest): Promise<ContainerAuth> {
  const { provider, source, projectRoot } = request;
  const now = request.now ?? Date.now;
  const minimum = request.minOAuthValidityMs ?? MIN_OAUTH_LIFETIME_MS;
  const agentDir = agentDirOf(source);
  let stored = readStored(agentDir, provider);

  let credential: Record<string, unknown> | undefined;
  let expiresAt: number | null = null;
  if (stored?.type === 'oauth') {
    if (stored.expires - now() < minimum && request.resolve !== undefined) {
      await request.resolve(provider);
      stored = readStored(agentDir, provider);
    }
    if (stored?.type !== 'oauth') throw new ProviderAuthUnavailableError(`the stored credential for ${provider} changed while it was refreshed`);
    const left = stored.expires - now();
    if (left < minimum)
      throw new ProviderAuthUnavailableError(
        `the stored OAuth token for ${provider} ${left <= 0 ? 'has expired' : `expires in ${Math.round(left / 60_000)} min`}, and a container worker cannot refresh it (it never holds the refresh token). Pi refreshes a token in its last 5 minutes: use ${provider} in a Pi session, or /login, then spawn again.`,
      );
    credential = { type: 'oauth', access: stored.access, refresh: '', expires: stored.expires };
    expiresAt = stored.expires;
  } else if (stored?.type === 'api_key') {
    let key = stored.key;
    if (key !== undefined && !isLiteral(key)) {
      if (request.resolve === undefined) throw new ProviderAuthUnavailableError(`the stored key for ${provider} is a command or an environment reference, and only Pi can resolve it; spawn from a Pi session, or store the key itself with /login`);
      const resolved = await request.resolve(provider);
      if (typeof resolved !== 'string' || resolved === '') throw new ProviderAuthUnavailableError(`Pi could not resolve the stored key for ${provider}`);
      key = resolved;
    }
    credential = { type: 'api_key', ...(key === undefined ? {} : { key }) };
  }

  const explicit = request.packages ?? (source['PSTACK_CONTAINER_PROVIDER_PACKAGES'] ? source['PSTACK_CONTAINER_PROVIDER_PACKAGES'].split(delimiter).filter(Boolean) : []);
  const packages = request.builtin.has(provider) && explicit.length === 0 ? { mounts: [], extensions: [] } : findProviderPackages(provider, agentDir, projectRoot, explicit);
  // With a credential stored for it, a provider the container cannot load would fail there with "Model not found"; say so here instead.
  if (credential !== undefined && !request.builtin.has(provider) && packages.extensions.length === 0)
    throw new ProviderAuthUnavailableError(
      `${provider} has a stored credential but is not a provider Pi has built in, and no installed Pi package (npm: or local, from settings.json) registers it, so a container worker could not load it. Set PSTACK_CONTAINER_PROVIDER_PACKAGES to the package directory.`,
    );
  for (const path of [...packages.mounts, ...packages.extensions]) if (!isAbsolute(path)) throw new Error(`${path} is not absolute`);
  return { authJson: credential === undefined ? null : JSON.stringify({ [provider]: credential }), kind: credential === undefined ? 'none' : (credential['type'] as 'api_key' | 'oauth'), expiresAt, packages };
}
