import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { Script } from 'node:vm';

const [referenceArg, outputArg] = process.argv.slice(2);
if (!referenceArg || !outputArg) throw new Error('Usage: node capture-reference.mjs <plugins-archive-root> <evidence-directory>');
const reference = resolve(referenceArg);
const output = resolve(outputArg);
const revision = 'bb68f2365eceafa0cb2d253112f675acf5f144cc';
const cli = join(homedir(), '.local/share/cursor-agent/versions/2026.10.22-27dcf5f');
const installed = join(homedir(), '.cursor/plugins/cache/cursor-public/pstack/ae5650febf4320793844c12c4adaa937f417f8da');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (['.git', 'node_modules', 'coverage'].includes(entry.name)) return [];
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
    })
    .sort();
const textFile = /\.(?:md|mdc|ts|js|mjs|cjs|json|ya?ml|sh|html|css|cfg|tla|toml|txt)$|(?:^|\/)(?:bun\.lock|statechart)$/;
const sources = [];
const edges = [];
for (const component of ['pstack', 'cursor-team-kit', 'cursor-sdk']) {
  const dir = join(reference, component);
  if (!existsSync(dir)) continue;
  for (const path of walk(dir)) {
    const file = relative(reference, path);
    const bytes = readFileSync(path);
    const text = textFile.test(file) ? bytes.toString('utf8') : undefined;
    const cached = component === 'pstack' ? join(installed, relative(dir, path)) : undefined;
    sources.push({ id: `SOURCE:${file}`, file, revision, sha256: hash(bytes), bytes: bytes.length, installedMatch: cached === undefined ? null : existsSync(cached) && hash(readFileSync(cached)) === hash(bytes), semanticReview: 'pending' });
    if (text === undefined) continue;
    for (const [index, line] of text.split('\n').entries()) {
      for (const match of line.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]|https?:\/\/[^\s<>`"')]+|(?:\.\.\/)+(?:[\w./-]+)|cursor-team-kit|cursor-subscriptions[\w-]*/g)) {
        edges.push({ file, line: index + 1, column: match.index + 1, target: match[1] ?? match[0], review: 'pending' });
      }
    }
  }
}
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'sources.json'), `${JSON.stringify({ revision, sources, dependencyCandidates: edges }, null, 2)}\n`);
const modules = [];
const unavailableChunks = [];
for (const path of readdirSync(cli)
  .filter((file) => /^(?:\d+\.)?index\.js$/.test(file))
  .sort()
  .map((file) => join(cli, file))) {
  const source = readFileSync(path, 'utf8');
  const exports = {};
  try {
    const tableStart = source.indexOf('var __webpack_modules__=');
    const tableEnd = source.indexOf(',__webpack_module_cache__=');
    const capture = basename(path) === 'index.js' ? `exports.modules=${source.slice(tableStart + 'var __webpack_modules__='.length, tableEnd)}` : source;
    if (basename(path) === 'index.js' && (tableStart < 0 || tableEnd <= tableStart)) throw new Error('Main webpack module table not found');
    new Script(capture, { filename: path }).runInNewContext({ exports }, { timeout: 1_000, contextCodeGeneration: { strings: false, wasm: false } });
  } catch (error) {
    unavailableChunks.push({ file: basename(path), error: String(error) });
    continue;
  }
  for (const [name, factory] of Object.entries(exports.modules ?? {})) {
    if (!/shell|background|subagent|subscription|custom-mode|plugin|plan-utils|terminal|^\.\.\/(?:agent-exec|agent-exec-node|local-exec|skills|agent-resources)\/dist\/(?:index|node)\.js$/i.test(name)) continue;
    if (typeof factory !== 'function') continue;
    const id = hash(Buffer.from(`${basename(path)}:${name}`)).slice(0, 16);
    const body = factory.toString();
    modules.push({
      id,
      file: basename(path),
      fileSha256: hash(source),
      name,
      bytes: Buffer.byteLength(body),
      factorySha256: hash(body),
      evidence: `modules/${id}.js`,
      extraction: 'Webpack factory captured without invoking it',
      semanticReview: 'pending',
    });
    mkdirSync(join(output, 'modules'), { recursive: true });
    writeFileSync(join(output, 'modules', `${id}.js`), `({${body}})\n`);
  }
}
writeFileSync(join(output, 'host-modules.json'), `${JSON.stringify({ cliVersion: '2026.10.22-27dcf5f', modules, unavailableChunks }, null, 2)}\n`);
console.log(
  JSON.stringify({ sources: sources.length, dependencyCandidates: edges.length, cachedMismatches: sources.filter((row) => row.installedMatch === false).map((row) => row.file), hostModules: modules.length, unavailableChunks }, null, 2),
);
