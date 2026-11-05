// A repository describes its cloud machine in `.pi/environment.json`, the counterpart of Cursor's committed
// `.cursor/environment.json`: a base image or a Dockerfile build, an install script run before the agent starts, a
// start command, and long-running terminals. The file is read from the machine's own clone, so only committed and
// pushed configuration applies, as it does for Cursor's cloud agents.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ENVIRONMENT_FILE = join('.pi', 'environment.json');
export const DEFAULT_IMAGE_ENV = 'PSTACK_CLOUD_IMAGE';
/** Debian with git, curl, python3, and a C toolchain, plus Node: enough to clone, build, and test most repositories. */
export const DEFAULT_IMAGE = 'node:24-bookworm';

export interface Terminal {
  name: string;
  command: string;
}

export interface Environment {
  /** Where the configuration came from, or undefined for the defaults. */
  source: string | undefined;
  image: { kind: 'pull'; reference: string } | { kind: 'build'; dockerfile: string; context: string; tag: string };
  install: string | undefined;
  start: string | undefined;
  terminals: Terminal[];
}

const fail = (path: string, problem: string): never => {
  throw new Error(`${path}: ${problem}`);
};

const optionalString = (path: string, value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') return fail(path, `${field} must be a non-empty string`);
  return value;
};

function terminalsOf(path: string, value: unknown): Terminal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(path, 'terminals must be an array of { name, command }');
  return value.map((entry, index) => {
    const terminal = entry as { name?: unknown; command?: unknown } | null;
    if (typeof terminal !== 'object' || terminal === null) return fail(path, `terminals[${index}] must be an object`);
    const command = optionalString(path, terminal.command, `terminals[${index}].command`);
    if (command === undefined) return fail(path, `terminals[${index}].command is required`);
    return { name: optionalString(path, terminal.name, `terminals[${index}].name`) ?? `terminal ${index + 1}`, command };
  });
}

/** Parses the machine's environment from a checkout; a malformed file fails the launch instead of being ignored. */
export function readEnvironment(repo: string, env: NodeJS.ProcessEnv = process.env): Environment {
  const path = join(repo, ENVIRONMENT_FILE);
  const fallbackImage = env[DEFAULT_IMAGE_ENV] === undefined || env[DEFAULT_IMAGE_ENV] === '' ? DEFAULT_IMAGE : env[DEFAULT_IMAGE_ENV];
  if (!existsSync(path)) return { source: undefined, image: { kind: 'pull', reference: fallbackImage }, install: undefined, start: undefined, terminals: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(path, `not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(path, 'must be a JSON object');
  const config = raw as Record<string, unknown>;
  const known = new Set(['image', 'build', 'install', 'start', 'terminals']);
  const unknown = Object.keys(config).filter((key) => !known.has(key));
  if (unknown.length > 0) fail(path, `unknown field${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}`);
  const reference = optionalString(path, config['image'], 'image');
  let image: Environment['image'] = { kind: 'pull', reference: reference ?? fallbackImage };
  if (config['build'] !== undefined) {
    if (reference !== undefined) fail(path, 'set image or build, not both');
    const build = config['build'] as { dockerfile?: unknown; context?: unknown } | null;
    if (typeof build !== 'object' || build === null) return fail(path, 'build must be an object with a dockerfile');
    const dockerfile = optionalString(path, build.dockerfile, 'build.dockerfile');
    if (dockerfile === undefined) return fail(path, 'build.dockerfile is required');
    const base = join(repo, '.pi');
    const file = resolve(base, dockerfile);
    if (!existsSync(file)) fail(path, `build.dockerfile ${file} does not exist`);
    const context = resolve(base, optionalString(path, build.context, 'build.context') ?? '.');
    const digest = createHash('sha256').update(readFileSync(file)).update('\0').update(context.slice(repo.length)).digest('hex').slice(0, 16);
    image = { kind: 'build', dockerfile: file, context, tag: `pstack-env:${digest}` };
  }
  return {
    source: path,
    image,
    install: optionalString(path, config['install'], 'install'),
    start: optionalString(path, config['start'], 'start'),
    terminals: terminalsOf(path, config['terminals']),
  };
}
