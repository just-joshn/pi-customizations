import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pi supplies extensions with only the pi-ai root, compat, oauth, and
// providers/all entry points. The Cloud Code stream needs Pi's internal Google
// conversion modules, so this copies their TypeScript sources out of the pinned
// devDependency's source maps. Import rewrites, the reviewed strict-policy patch,
// and root formatting are applied reproducibly before integrity comparison.
const root = fileURLToPath(new URL('..', import.meta.url));
// The package manager may link the Pi install instead of copying it. Resolving
// through the link's real location finds the @google/genai version Pi pins,
// which is the one the vendored enums have to match.
const piAi = realpathSync(join(root, 'node_modules/@earendil-works/pi-ai'));
const genai = genaiPackageRoot(join(piAi, 'package.json'));
const target = join(root, 'src/pi-ai');
const sources = ['api/google-shared', 'api/transform-messages', 'api/constrained-sampling', 'api/simple-options', 'utils/estimate', 'utils/provider-retry', 'utils/sanitize-unicode', 'utils/headers'];
const rewrites = new Map([
  ['@google/genai', './genai.ts'],
  ['../types.ts', '@earendil-works/pi-ai'],
  ['../models.ts', '@earendil-works/pi-ai'],
  ['../utils/transcript.ts', '@earendil-works/pi-ai'],
  ['./text.ts', '@earendil-works/pi-ai'],
  ['../utils/estimate.ts', './estimate.ts'],
  ['../utils/provider-retry.ts', './provider-retry.ts'],
  ['../utils/sanitize-unicode.ts', './sanitize-unicode.ts'],
  ['./constrained-sampling.ts', './constrained-sampling.ts'],
  ['./transform-messages.ts', './transform-messages.ts'],
]);
const enums = ['FinishReason', 'FunctionCallingConfigMode', 'ThinkingLevel'];
const genaiTypes = `export interface Part {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	inlineData?: { mimeType?: string; data?: string };
	functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
	functionResponse?: { id?: string; name?: string; response?: Record<string, unknown>; parts?: Part[] };
}

export interface Content {
	role?: string;
	parts?: Part[];
}

export interface ThinkingConfig {
	includeThoughts?: boolean;
	thinkingBudget?: number;
	thinkingLevel?: ThinkingLevel;
}
`;

async function version(dir) {
  return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version;
}

// @google/genai does not export its package.json, so walk up from its entry
// point to the directory that owns the manifest. Resolving from the Pi install's
// manifest is what ties the version to Pi rather than to this package.
function genaiPackageRoot(piAiManifest) {
  let directory = dirname(createRequire(piAiManifest).resolve('@google/genai'));
  while (!existsSync(join(directory, 'package.json'))) directory = dirname(directory);
  return directory;
}

async function vendored(source, piAiVersion) {
  const map = JSON.parse(await readFile(join(piAi, 'dist', `${source}.js.map`), 'utf8'));
  const text = map.sourcesContent[0].replace(/(from |import\()"([^"]+)"/g, (match, prefix, specifier) => {
    if (!specifier.startsWith('.') && specifier !== '@google/genai') return match;
    const rewritten = rewrites.get(specifier);
    if (!rewritten) throw new Error(`No rewrite for ${specifier} in ${source}.ts`);
    return `${prefix}"${rewritten}"`;
  });
  return `// Vendored from @earendil-works/pi-ai ${piAiVersion} src/${source}.ts (MIT) by scripts/vendor-pi-ai.mjs. Only import specifiers differ. Do not edit.\n${text}`;
}

async function genaiShim() {
  const declarations = await readFile(join(genai, 'dist/genai.d.ts'), 'utf8');
  const values = enums.map((name) => {
    const body = declarations.match(new RegExp(`export declare enum ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
    if (!body) throw new Error(`@google/genai does not declare enum ${name}`);
    const members = [...body.matchAll(/^\s+(\w+) = "([^"]+)"/gm)].map(([, key, value]) => `\t${key}: "${value}",`);
    return `export const ${name} = {\n${members.join('\n')}\n} as const;\nexport type ${name} = (typeof ${name})[keyof typeof ${name}];\n`;
  });
  return `// Generated from @google/genai ${await version(genai)} by scripts/vendor-pi-ai.mjs. Do not edit.\n// Stand-ins for the @google/genai values and types the vendored Google modules use.\n${values.join('\n')}\n${genaiTypes}`;
}

async function adaptedModules(original) {
  const scratch = await mkdtemp(join(tmpdir(), 'pi-ai-vendor-'));
  try {
    for (const [name, text] of original) await writeFile(join(scratch, name), text);
    const patch = join(root, 'scripts/vendor-strict.patch');
    const paths = execFileSync('git', ['apply', '--numstat', '-p5', patch], { cwd: scratch, encoding: 'utf8' });
    for (const entry of paths.trim().split('\n')) {
      const [added, deleted, name] = entry.split('\t');
      if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted) || !original.has(name)) {
        throw new Error(`Unexpected vendor patch entry: ${entry}`);
      }
    }
    execFileSync('git', ['apply', '--check', '-p5', patch], { cwd: scratch });
    execFileSync('git', ['apply', '-p5', patch], { cwd: scratch });
    const repository = join(root, '../..');
    const biome = join(repository, 'node_modules/.bin/biome');
    const modules = new Map();
    for (const name of original.keys()) {
      const text = (await readFile(join(scratch, name), 'utf8')).replace('Only import specifiers differ.', 'Import specifiers, reviewed strict-TypeScript adaptations and shared formatting differ.');
      const formatted = execFileSync(biome, ['check', '--write', '--stdin-file-path', join(target, name), '--config-path', join(repository, 'biome.json')], { input: text, encoding: 'utf8' });
      modules.set(name, formatted);
    }
    return modules;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const piAiVersion = await version(piAi);
const original = new Map([['genai.ts', await genaiShim()]]);
for (const source of sources) original.set(`${source.split('/').at(-1)}.ts`, await vendored(source, piAiVersion));
const expected = await adaptedModules(original);

if (process.argv.includes('--check')) {
  const present = new Set((await readdir(target).catch(() => [])).filter((name) => name.endsWith('.ts')));
  const stale = [...expected].filter(([name]) => !present.has(name)).map(([name]) => name);
  for (const [name, text] of expected) if (present.has(name) && (await readFile(join(target, name), 'utf8')) !== text) stale.push(name);
  const extra = [...present].filter((name) => !expected.has(name));
  if (stale.length || extra.length) {
    process.stderr.write(`Vendored pi-ai modules differ from @earendil-works/pi-ai ${piAiVersion}: ${[...stale, ...extra].join(', ')}. Run bun run vendor.\n`);
    process.exit(1);
  }
  process.stdout.write(`Vendored modules match @earendil-works/pi-ai ${piAiVersion}.\n`);
} else {
  await mkdir(target, { recursive: true });
  for (const [name, text] of expected) await writeFile(join(target, name), text);
  process.stdout.write(`Wrote ${expected.size} modules from @earendil-works/pi-ai ${piAiVersion} to src/pi-ai.\n`);
}
