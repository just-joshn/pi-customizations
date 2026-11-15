#!/usr/bin/env node
// Dumps the protobuf schema embedded in an installed cursor-agent bundle as proto-like text.
// Usage: node extract-cursor-schema.mjs <cursor-agent version dir> > cursor-schema.txt
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: extract-cursor-schema.mjs <cursor-agent version dir>');

const SCALARS = { 1: 'double', 2: 'float', 3: 'int64', 4: 'uint64', 5: 'int32', 6: 'fixed64', 7: 'fixed32', 8: 'bool', 9: 'string', 12: 'bytes', 13: 'uint32', 15: 'sfixed32', 16: 'sfixed64', 17: 'sint32', 18: 'sint64' };
const MODULE_START = /"((?:\.\.\/|\.\/)[^"]+?\.js)"\([\w$]+,[\w$]+,[\w$]+\)\{/g;

const modules = new Map();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const starts = [...src.matchAll(MODULE_START)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    if (!modules.has(m[1])) modules.set(m[1], src.slice(m.index, end));
  });
}

const resolved = new Map(); // module path -> { locals: Map(var -> fullName), exports: Map(exportName -> var), imports: Map(var -> path) }
const messages = new Map(); // fullName -> { spec, refs: [{mod, expr}] }
const enums = new Map(); // fullName -> [[no, name]]

for (const [modPath, body] of modules) {
  if (!body.includes('static $()') && !body.includes('.QT)(')) continue;
  const imports = new Map([...body.matchAll(/([\w$]+)=[\w$]+\("([^"]+)"\)/g)].map((m) => [m[1], m[2]]));
  const exportsMap = new Map();
  const exp = body.match(/[\w$]+\.d\([\w$]+,\{([^}]*)\}\)/);
  if (exp) for (const m of exp[1].matchAll(/([\w$]+):\(\)=>([\w$]+)/g)) exportsMap.set(m[1], m[2]);
  const prefixes = new Map([...body.matchAll(/class ([\w$]+) extends [\w$.]+\{static get runtime\(\)\{[^}]*\}static \$p\(\)\{return\s*("[^"]*"|[\w$]+)\}\}/g)].map((m) => [m[1], m[2]]));
  const strConsts = new Map([...body.matchAll(/[,;\s{(]([\w$]+)="([a-z][\w]*(?:\.[\w]+)*\.)"/g)].map((m) => [m[1], m[2]]));
  const prefixOf = (tok) => (tok.startsWith('"') ? tok.slice(1, -1) : (strConsts.get(tok) ?? '?.'));
  const locals = new Map();
  for (const m of body.matchAll(/class ([\w$]+) extends ([\w$]+)\{(?:(?!class [\w$]+ extends).)*?static \$\(\)\{return\["([^"]+)"((?:,[\w$.]+)*)\]\}/gs)) {
    const pre = prefixes.has(m[2]) ? prefixOf(prefixes.get(m[2])) : '?.';
    const name = pre + m[3].split('|')[0];
    locals.set(m[1], name);
    const refs = m[4]
      .split(',')
      .filter(Boolean)
      .map((expr) => ({ mod: modPath, expr }));
    messages.set(name, { spec: m[3], refs });
  }
  for (const m of body.matchAll(/(?:var|const|let)?\s*([\w$]+)=\(0,[\w$]+\.QT\)\([\w$.]+,("[^"]*"|[\w$]+),"([^"]+)",(\[\[.*?\]\])(?:,\d)?\)/g)) {
    const name = prefixOf(m[2]) + m[3];
    locals.set(m[1], name);
    enums.set(name, JSON.parse(m[4]));
  }
  resolved.set(modPath, { locals, exports: exportsMap, imports });
}

function resolveRef({ mod, expr }) {
  const r = resolved.get(mod);
  if (!r) return `?${expr}`;
  const [head, member] = expr.split('.');
  if (!member) return r.locals.get(head) ?? `?${expr}`;
  const target = r.imports.get(head);
  const tr = target && resolved.get(target);
  if (!tr) return `?${expr}`;
  const local = tr.exports.get(member) ?? member;
  return tr.locals.get(local) ?? `?${expr}`;
}

function fieldType(tok, refs) {
  if (tok.startsWith('#')) return resolveRef(refs[Number(tok.slice(1))] ?? { mod: '', expr: tok });
  return SCALARS[tok] ?? `scalar${tok}`;
}

const out = [];
for (const [name, { spec, refs }] of [...messages].sort(([a], [b]) => a.localeCompare(b))) {
  out.push(`message ${name} {`);
  for (const part of spec.split('|').slice(1)) {
    const tokens = part.split(' ');
    if (tokens.at(-1)?.startsWith('=')) tokens.pop();
    const [no, field, rawType, oneof] = tokens;
    const suffix = rawType.at(-1);
    const label = suffix === '?' ? 'optional ' : suffix === '*' ? 'repeated ' : '';
    const type = label ? rawType.slice(0, -1) : rawType;
    const comma = type.indexOf(',');
    const t = comma >= 0 ? `map<${fieldType(type.slice(0, comma), refs)}, ${fieldType(type.slice(comma + 1), refs)}>` : fieldType(type, refs);
    out.push(`  ${label}${t} ${field} = ${no};${oneof ? ` // oneof ${oneof}` : ''}`);
  }
  out.push('}');
}
for (const [name, values] of [...enums].sort(([a], [b]) => a.localeCompare(b))) {
  out.push(`enum ${name} { ${values.map(([n, v]) => `${v} = ${n};`).join(' ')} }`);
}
process.stdout.write(`${out.join('\n')}\n`);
process.stderr.write(`messages=${messages.size} enums=${enums.size} unresolved=${(out.join('\n').match(/\?[\w$.]+/g) ?? []).length}\n`);
