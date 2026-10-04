import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const scripts = 'skills/poteto-mode/scripts';
const compilerReason = 'Snapshot the root compiler policy for portable scripts, including tests, with Node and Bun ambient types.';
const formatReason = 'Format and organize generated code with the root Biome policy.';

export async function scriptsCompilerPolicy(policyRoot) {
  const require = createRequire(join(policyRoot, 'package.json'));
  const { createScanner, SyntaxKind } = await import(pathToFileURL(require.resolve('typescript/unstable/ast')));
  const { compilerOptionsText } = await import(pathToFileURL(join(policyRoot, 'scripts/typescript-policy.mjs')));
  const options = compilerOptionsText(await readFile(join(policyRoot, 'tsconfig.json'), 'utf8'));
  const scanner = createScanner(true, undefined, options);
  let depth = 0;
  let portable;
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (depth === 1 && token === SyntaxKind.StringLiteral && scanner.getTokenValue() === 'types') {
      if (scanner.scan() !== SyntaxKind.ColonToken || scanner.scan() !== SyntaxKind.OpenBracketToken) throw new Error('Root compiler types must be an array.');
      const start = scanner.getTokenStart();
      for (let next = scanner.scan(); next !== SyntaxKind.CloseBracketToken; next = scanner.scan()) {
        if (next === SyntaxKind.EndOfFile) throw new Error('Unclosed root compiler types array.');
      }
      portable = `${options.slice(0, start)}["node", "bun-types"]${options.slice(scanner.getTokenEnd())}`;
      break;
    }
    if (token === SyntaxKind.OpenBraceToken) depth += 1;
    if (token === SyntaxKind.CloseBraceToken) depth -= 1;
  }
  if (!portable) throw new Error('Root compiler policy must declare ambient types.');
  const snapshot = (prefix) => `{
  "compilerOptions": ${portable},
  "include": ${JSON.stringify(['ts', 'tsx', 'mts', 'cts'].map((extension) => `${prefix}**/*.${extension}`))},
  "exclude": ${JSON.stringify(['node_modules', 'dist', 'build', 'coverage'].map((directory) => `${prefix}**/${directory}/**`))}
}\n`;
  return {
    snapshot: snapshot(''),
    upstreamSnapshot: snapshot('../'),
    redirect: '{\n  "extends": "../tsconfig.json",\n  "include": ["../**/*.ts", "../**/*.tsx", "../**/*.mts", "../**/*.cts"]\n}\n',
  };
}

export function adaptScriptsPolicy(entry, result, policy) {
  if (entry.path === `${scripts}/watch-pr/tsconfig.json`) return { generated: Buffer.from(policy.redirect), transformations: [...result.transformations, compilerReason] };
  if (entry.path !== `${scripts}/package.json`) return result;
  const manifest = JSON.parse(result.generated.toString('utf8'));
  if (!manifest.scripts?.typecheck) throw new Error('Helper manifest must declare a typecheck command.');
  return {
    generated: Buffer.from(`${JSON.stringify({ ...manifest, scripts: { ...manifest.scripts, typecheck: 'tsc --project tsconfig.json' } }, null, 2)}\n`),
    transformations: [...result.transformations, 'Typecheck the entire portable scripts project, including tests, under the root-derived policy.'],
  };
}

export function scriptsPolicyOutput(policy) {
  return {
    source: '../../tsconfig.json',
    destination: `${scripts}/tsconfig.json`,
    generated: Buffer.from(policy.snapshot),
    mode: 0o644,
    executable: false,
    transformations: [compilerReason],
  };
}

export async function formatGeneratedOutputs(outputs, policyRoot) {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-resource-format-'));
  try {
    const formatted = outputs.filter((output) => /\.(?:[cm]?[jt]sx?|jsonc?)$/.test(output.destination));
    if (!formatted.length) return outputs;
    for (const output of formatted) {
      const path = join(directory, output.destination);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, output.generated);
    }
    execFileSync(
      join(policyRoot, 'node_modules/.bin/biome'),
      ['check', '--write', '--linter-enabled=false', '--assist-enabled=true', '--enforce-assist=true', '--vcs-enabled=false', '--config-path', join(policyRoot, 'biome.json'), directory],
      { cwd: policyRoot, stdio: 'pipe' },
    );
    const bytes = new Map(await Promise.all(formatted.map(async (output) => [output.destination, await readFile(join(directory, output.destination))])));
    return outputs.map((output) => {
      const generated = bytes.get(output.destination);
      if (!generated || generated.equals(output.generated)) return output;
      return { ...output, generated, transformations: [...output.transformations, formatReason] };
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
