import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pi supplies extensions with only the pi-ai root, compat, oauth, and
// providers/all entry points. The Cloud Code stream needs Pi's internal Google
// conversion modules, so this copies their TypeScript sources out of the pinned
// devDependency's source maps and rewrites only import specifiers.
const root = fileURLToPath(new URL('..', import.meta.url));
const piAi = join(root, 'node_modules/@earendil-works/pi-ai');
const genai = join(root, 'node_modules/@google/genai');
const target = join(root, 'src/pi-ai');
const sources = [
  'api/google-shared', 'api/transform-messages', 'api/constrained-sampling', 'api/simple-options',
  'utils/estimate', 'utils/provider-retry', 'utils/sanitize-unicode', 'utils/headers',
];
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
  const values = enums.map(name => {
    const body = declarations.match(new RegExp(`export declare enum ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
    if (!body) throw new Error(`@google/genai does not declare enum ${name}`);
    const members = [...body.matchAll(/^\s+(\w+) = "([^"]+)"/gm)].map(([, key, value]) => `\t${key}: "${value}",`);
    return `export const ${name} = {\n${members.join('\n')}\n} as const;\nexport type ${name} = (typeof ${name})[keyof typeof ${name}];\n`;
  });
  return `// Generated from @google/genai ${await version(genai)} by scripts/vendor-pi-ai.mjs. Do not edit.\n// Stand-ins for the @google/genai values and types the vendored Google modules use.\n${values.join('\n')}\n${genaiTypes}`;
}

const piAiVersion = await version(piAi);
const expected = new Map([['genai.ts', await genaiShim()]]);
for (const source of sources) expected.set(`${source.split('/').at(-1)}.ts`, await vendored(source, piAiVersion));

if (process.argv.includes('--check')) {
  const present = new Set((await readdir(target).catch(() => [])).filter(name => name.endsWith('.ts')));
  const stale = [...expected].filter(([name, text]) => !present.has(name)).map(([name]) => name);
  for (const [name, text] of expected) if (present.has(name) && await readFile(join(target, name), 'utf8') !== text) stale.push(name);
  const extra = [...present].filter(name => !expected.has(name));
  if (stale.length || extra.length) {
    process.stderr.write(`Vendored pi-ai modules differ from @earendil-works/pi-ai ${piAiVersion}: ${[...stale, ...extra].join(', ')}. Run npm run vendor.\n`);
    process.exit(1);
  }
  process.stdout.write(`Vendored modules match @earendil-works/pi-ai ${piAiVersion}.\n`);
} else {
  await mkdir(target, { recursive: true });
  for (const [name, text] of expected) await writeFile(join(target, name), text);
  process.stdout.write(`Wrote ${expected.size} modules from @earendil-works/pi-ai ${piAiVersion} to src/pi-ai.\n`);
}
