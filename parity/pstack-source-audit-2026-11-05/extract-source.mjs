import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
const require = createRequire(import.meta.url);
const { parse } = require(join(repo, 'node_modules/.bun/@babel+parser@7.29.9/node_modules/@babel/parser/lib/index.js'));
const DESKTOP = '/usr/share/cursor/resources/app/extensions/cursor-local-agent-runtime/dist/main.js';
const CLI = '/home/josh/.local/share/cursor-agent/versions/2026.10.22-27dcf5f/index.js';
// Cursor's code stays out of the public repository: raw captures go to the ignored .audit tree.
const RAW = '.audit/pstack-source-audit-2026-11-05/source';

// Each capture is the complete function that encloses a marker, so a reviewer never relies on a guessed slice.
const specs = [
  { id: 'desktop-task-run', file: DESKTOP, marker: 'Cannot resume a "${v}" subagent as' },
  { id: 'desktop-task-conversation-state', file: DESKTOP, marker: 'Created new conversation state (restore failed)' },
  { id: 'desktop-task-schema', file: DESKTOP, marker: 'Optional placement: where the subagent runs.', up: 1 },
  { id: 'cli-agent-file-parser', file: CLI, marker: '"force-default-model"' },
  { id: 'cli-plugin-agent-loader', file: CLI, marker: 'const n=(0,Bs.DuR)(r,{stripModel:!0,stripTools:!0});' },
  { id: 'cli-plugin-agent-parser', file: CLI, marker: 'const o=n.data.permissionMode??n.data.permissionmode,a=(0,x.basename)(e);' },
  { id: 'cli-plugin-agent-convert', file: CLI, marker: 'function Bu(t,e={stripModel:!0,stripTools:!0}){' },
  { id: 'cli-plugin-agent-strip', file: CLI, marker: 'function hu(t,e={}){return{...t,model:e.stripModel?void 0:t.model' },
  { id: 'desktop-task-description', file: DESKTOP, marker: '"no-subagent-unless-asked"===F&&(d=`IMPORTANT: Do NOT use this tool unless' },
  { id: 'desktop-task-description-text', file: DESKTOP, marker: 'Launch a new agent to handle complex, multi-step tasks' },
];
const wanted = process.argv.length > 2 ? specs.filter((spec) => process.argv.slice(2).includes(spec.id)) : specs;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);

function enclosingFunction(ast, offset, up = 0) {
  const chain = [];
  const visit = (node) => {
    if (node === null || typeof node !== 'object' || node.start > offset || node.end <= offset) return;
    if (FUNCTIONS.has(node.type)) chain.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value !== null && typeof value === 'object' && typeof value.type === 'string') visit(value);
    }
  };
  visit(ast.program);
  return chain[chain.length - 1 - up];
}

const parsed = new Map();
const manifestPath = join(root, 'evidence/source-captures.json');
let manifest = [];
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
mkdirSync(join(repo, RAW), { recursive: true });
for (const spec of wanted) {
  const source = readFileSync(spec.file, 'utf8');
  if (!parsed.has(spec.file)) parsed.set(spec.file, parse(source, { sourceType: 'script', errorRecovery: true, allowReturnOutsideFunction: true }));
  const offset = source.indexOf(spec.marker);
  assert.notEqual(offset, -1, `${spec.id}: marker missing`);
  assert.equal(source.indexOf(spec.marker, offset + 1), -1, `${spec.id}: marker is not unique`);
  const fn = enclosingFunction(parsed.get(spec.file), offset, spec.up ?? 0);
  assert.ok(fn, `${spec.id}: no enclosing function`);
  const text = source.slice(fn.start, fn.end);
  const file = `${RAW}/${spec.id}.js`;
  writeFileSync(join(repo, file), `${text}\n`);
  const entry = { id: spec.id, source: spec.file, sourceSha256: hash(source), marker: spec.marker, up: spec.up ?? 0, start: fn.start, end: fn.end, functionName: fn.id?.name ?? null, excerptSha256: hash(text), file };
  manifest = [...manifest.filter((candidate) => candidate.id !== spec.id), entry];
  console.log(`${spec.id}: ${fn.type} ${entry.functionName ?? '(anonymous)'} ${fn.start}-${fn.end} (${text.length} chars)`);
}
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    manifest.toSorted((a, b) => a.id.localeCompare(b.id)),
    null,
    2,
  )}\n`,
);
