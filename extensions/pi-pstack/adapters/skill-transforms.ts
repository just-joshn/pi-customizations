import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { AGENT_OUTPUTS, BUILTIN_COMMANDS, GENERAL_ROLE, KEEPS, type Keep, PRIMITIVES, type PrimitiveId, promptTemplate, RULES, type Rule, WORKER_ASSIGNMENT_PATH, WORKER_ASSIGNMENT_REFERENCE } from './cursor-to-pi.ts';
import { buildDependencyManifest, detectPrimitives, type Hit, lineAt } from './dependencies.ts';
import { UPSTREAM, VENDOR_ROOTS } from './provenance.ts';

export interface Span {
  readonly file: string;
  readonly rule: string;
  readonly offset: readonly [number, number];
  readonly lines: readonly [number, number];
  readonly original: string;
  readonly replacement: string;
}

export class RuleError extends Error {}

function occurrences(text: string, find: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) found.push(at);
  return found;
}

export function rulesForFile(rules: readonly Rule[], file: string): Rule[] {
  return rules.filter((rule) => Object.hasOwn(rule.files, file));
}

export function applyRules(source: string, file: string, rules: readonly Rule[]): { text: string; spans: Span[] } {
  const spans: Span[] = [];
  for (const rule of rulesForFile(rules, file)) {
    const expected = rule.files[file] ?? 0;
    const found = occurrences(source, rule.find);
    if (found.length !== expected) {
      throw new RuleError(`${file}: rule ${rule.id} expected ${expected} match(es), found ${found.length}`);
    }
    for (const start of found) {
      const end = start + rule.find.length;
      spans.push({
        file,
        rule: rule.id,
        offset: [start, end],
        lines: [lineAt(source, start), lineAt(source, end - 1)],
        original: rule.find,
        replacement: rule.replace,
      });
    }
  }
  spans.sort((a, b) => a.offset[0] - b.offset[0]);
  spans.reduce<Span | null>((previous, span) => {
    if (previous && span.offset[0] < previous.offset[1]) throw new RuleError(`${file}: rules ${previous.rule} and ${span.rule} overlap at line ${span.lines[0]}`);
    return span;
  }, null);
  return { text: applySpans(source, spans), spans };
}

export function applySpans(source: string, spans: readonly Span[]): string {
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    const [start, end] = span.offset;
    if (start < cursor || source.slice(start, end) !== span.original) {
      throw new RuleError(`${span.file}: span ${span.rule} at line ${span.lines[0]} does not match the source`);
    }
    out += source.slice(cursor, start) + span.replacement;
    cursor = end;
  }
  return out + source.slice(cursor);
}

export interface Output {
  readonly path: string;
  readonly source: string | null;
  readonly text?: string;
}

export interface TransformationManifest {
  readonly schemaVersion: 1;
  readonly upstream: typeof UPSTREAM;
  readonly counts: { skills: number; agents: number; prompts: number; rules: number; spans: number };
  readonly skills: readonly string[];
  readonly rules: readonly { id: string; primitives: readonly string[]; files: Readonly<Record<string, number>> }[];
  readonly keeps: readonly Keep[];
  readonly spans: readonly (Span & { output: string })[];
}

const MAPPED = new Set(PRIMITIVES.filter((p) => p.disposition === 'map').map((p) => p.id));
const SCRIPT_MAPPED = new Set<PrimitiveId>(['cursor-path', 'cursor-transcripts']);

export function replacedRanges(spans: readonly Span[]): [number, number][] {
  let delta = 0;
  return spans.map((span) => {
    const start = span.offset[0] + delta;
    delta += span.replacement.length - (span.offset[1] - span.offset[0]);
    return [start, start + span.replacement.length];
  });
}

export function residualHits(text: string, file: string, output: string, replaced: readonly [number, number][] = []): Hit[] {
  const ids = output.endsWith('.md') ? MAPPED : SCRIPT_MAPPED;
  return detectPrimitives(text, file, ids)
    .filter((hit) => !replaced.some(([a, b]) => (hit.offset ?? -1) >= a && (hit.offset ?? -1) + hit.text.length <= b))
    .map(({ offset: _, ...hit }) => hit);
}

export function unkeptResiduals(hits: readonly Hit[], keeps: readonly Keep[]): string[] {
  const problems: string[] = [];
  const byFile = new Map<string, Hit[]>();
  for (const hit of hits) byFile.set(hit.file, [...(byFile.get(hit.file) ?? []), hit]);
  for (const keep of keeps) {
    const matched = (byFile.get(keep.file) ?? []).filter((h) => h.id === keep.primitive && h.text === keep.text);
    if (matched.length !== keep.count) problems.push(`${keep.file}: keep "${keep.text}" expected ${keep.count} residual(s), found ${matched.length}`);
  }
  for (const hit of hits) {
    if (keeps.some((k) => k.file === hit.file && k.primitive === hit.id && k.text === hit.text)) continue;
    problems.push(`${hit.file}:${hit.line}: unmapped Cursor primitive ${hit.id} ("${hit.text}") remains in active text`);
  }
  return problems;
}

function stripFrontmatter(text: string, file: string): Span {
  const match = /^---\n[\s\S]*?\n---\n\n?/.exec(text);
  if (!match) throw new RuleError(`${file}: agent definition has no frontmatter`);
  return { file, rule: 'agent-frontmatter', offset: [0, match[0].length], lines: [1, lineAt(text, match[0].length - 1)], original: match[0], replacement: '' };
}

function frontmatter(text: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match ? (parse(match[1] ?? '') as Record<string, unknown>) : {};
}

export function compile(root: string, rules: readonly Rule[] = RULES, keeps: readonly Keep[] = KEEPS): { outputs: Output[]; manifest: TransformationManifest } {
  const deps = buildDependencyManifest(root);
  const problems: string[] = [
    ...deps.unknown.map((h) => `${h.file}:${h.line}: unknown Cursor dependency or primitive "${h.text}"`),
    ...deps.unresolved.map((r) => `${r.file}:${r.line}: reference "${r.target}" does not resolve in the vendored source`),
  ];
  const outputs: Output[] = [];
  const spans: (Span & { output: string })[] = [];
  const residuals: Hit[] = [];
  const touched = new Set<string>();
  const transform = (source: string, output: string, extra: Span[] = []) => {
    const original = readFileSync(join(root, source), 'utf8');
    try {
      const applied = applyRules(original, source, rules);
      const all = [...extra, ...applied.spans].sort((a, b) => a.offset[0] - b.offset[0]);
      const text = applySpans(original, all);
      spans.push(...all.map((s) => ({ ...s, output })));
      residuals.push(...residualHits(text, source, output, replacedRanges(all)));
      return text;
    } catch (error) {
      problems.push((error as Error).message);
      return original;
    }
  };
  const required = deps.skills.filter((s) => s.required);
  for (const skill of required) {
    for (const file of skill.files) {
      const source = `${VENDOR_ROOTS[skill.origin]}/skills/${skill.name}/${file}`;
      const output = `generated/skills/${skill.name}/${file}`;
      touched.add(source);
      if (rulesForFile(rules, source).length || /\.md$/.test(file)) outputs.push({ path: output, source, text: transform(source, output) });
      else outputs.push({ path: output, source });
    }
  }
  for (const [source, name] of Object.entries(AGENT_OUTPUTS)) {
    touched.add(source);
    const output = `generated/agents/${name}`;
    const text = readFileSync(join(root, source), 'utf8');
    outputs.push({ path: output, source, text: transform(source, output, [stripFrontmatter(text, source)]) });
  }
  outputs.push({ path: 'generated/agents/general.md', source: null, text: GENERAL_ROLE });
  outputs.push({ path: WORKER_ASSIGNMENT_PATH, source: null, text: WORKER_ASSIGNMENT_REFERENCE });
  for (const rule of rules) {
    for (const file of Object.keys(rule.files)) if (!touched.has(file)) problems.push(`rule ${rule.id} names ${file}, which the compile does not produce`);
  }
  problems.push(...unkeptResiduals(residuals, keeps));
  let prompts = 0;
  for (const skill of required) {
    const meta = frontmatter(readFileSync(join(root, VENDOR_ROOTS[skill.origin], 'skills', skill.name, 'SKILL.md'), 'utf8'));
    if (meta['user-invocable'] === false) continue;
    if (BUILTIN_COMMANDS.has(skill.name)) problems.push(`skill ${skill.name} conflicts with a built-in Pi command`);
    outputs.push({ path: `generated/prompts/${skill.name}.md`, source: null, text: promptTemplate(skill.name, String(meta['description'] ?? skill.name)) });
    prompts++;
  }
  if (problems.length) throw new RuleError(`compile failed:\n${problems.join('\n')}`);
  outputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  spans.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.offset[0] - b.offset[0]));
  return {
    outputs,
    manifest: {
      schemaVersion: 1,
      upstream: UPSTREAM,
      counts: { skills: required.length, agents: Object.keys(AGENT_OUTPUTS).length + 1, prompts, rules: rules.length, spans: spans.length },
      skills: required.map((s) => s.name),
      rules: rules.map((r) => ({ id: r.id, primitives: r.primitives, files: r.files })),
      keeps,
      spans,
    },
  };
}

const FRONTMATTER_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);

export function frontmatterProblems(text: string, dirName: string, file: string): string[] {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return [`${file}: missing frontmatter`];
  let meta: Record<string, unknown>;
  try {
    meta = parse(match[1] ?? '') as Record<string, unknown>;
  } catch (error) {
    return [`${file}: frontmatter is not valid YAML (${(error as Error).message.split('\n')[0]})`];
  }
  const problems: string[] = [];
  for (const key of Object.keys(meta)) if (!FRONTMATTER_KEYS.has(key)) problems.push(`${file}: frontmatter field "${key}" is not an Agent Skills field`);
  if (meta['name'] !== dirName) problems.push(`${file}: name "${String(meta['name'])}" does not match directory "${dirName}"`);
  if (typeof meta['name'] !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta['name']) || meta['name'].length > 64) problems.push(`${file}: invalid name`);
  if (typeof meta['description'] !== 'string' || !meta['description'].trim() || meta['description'].length > 1024) problems.push(`${file}: description missing or longer than 1024 characters`);
  return problems;
}
